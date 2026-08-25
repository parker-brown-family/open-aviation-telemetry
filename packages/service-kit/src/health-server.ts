import { createServer, type Server } from 'node:http';
import type { Logger } from './logger.js';

/**
 * A minimal probe endpoint for services that are not HTTP servers.
 *
 * A Kafka consumer and a RabbitMQ worker have no incoming traffic, but
 * Kubernetes still needs somewhere to ask "are you alive" and "are you working".
 * Without it the only failure signal is the process exiting, so a consumer that
 * is running but permanently unable to reach its broker looks perfectly healthy.
 *
 * Deliberately built on node:http rather than a framework: this serves three
 * routes and belongs in every service image, so it should add no dependencies.
 */
export interface HealthServerOptions {
  port: number;
  host?: string;
  service: string;
  log: Logger;
  /** Liveness. Return false only when the process is unrecoverably broken. */
  isAlive?: () => boolean;
  /** Readiness. Return the dependency picture; ready=false removes the pod from service. */
  checkReady: () => Promise<{ ready: boolean; dependencies: Record<string, unknown> }>;
  /** Prometheus text exposition, if the service keeps metrics. */
  metricsText?: () => string;
}

export class HealthServer {
  private server: Server | null = null;
  private readonly startedAt = Date.now();

  constructor(private readonly options: HealthServerOptions) {}

  async start(): Promise<void> {
    const { port, host = '0.0.0.0', service, log } = this.options;

    this.server = createServer((req, res) => {
      const url = req.url ?? '/';
      const send = (status: number, body: unknown, contentType = 'application/json'): void => {
        const payload = typeof body === 'string' ? body : JSON.stringify(body);
        res.writeHead(status, { 'content-type': contentType });
        res.end(payload);
      };

      if (url === '/health') {
        const alive = this.options.isAlive ? this.options.isAlive() : true;
        send(alive ? 200 : 503, {
          status: alive ? 'ok' : 'unhealthy',
          service,
          uptime_seconds: Math.round((Date.now() - this.startedAt) / 1000),
        });
        return;
      }

      if (url === '/ready') {
        this.options
          .checkReady()
          .then((result) => send(result.ready ? 200 : 503, result))
          .catch((err: unknown) =>
            send(503, {
              ready: false,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        return;
      }

      if (url === '/metrics' && this.options.metricsText) {
        send(200, this.options.metricsText(), 'text/plain; version=0.0.4; charset=utf-8');
        return;
      }

      send(404, { error: 'not_found' });
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(port, host, () => {
        log.info({ port, host }, 'health server listening');
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    this.server = null;
  }
}
