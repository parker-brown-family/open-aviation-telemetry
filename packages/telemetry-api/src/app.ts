import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { AppContext } from './context.js';
import { METRIC } from './metrics.js';
import { registerFleetRoutes } from './routes/fleet.js';
import { registerOpsRoutes } from './routes/ops.js';

/**
 * Builds the HTTP application from an explicit context.
 *
 * Kept separate from server.ts so tests can construct an app without binding a
 * port or owning process lifecycle.
 */
export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    // Fastify 5 distinguishes `logger` (a configuration object it builds a
    // logger from) from `loggerInstance` (an already-constructed one). Ours is
    // built in the service kit so every service logs identically.
    //
    // The cast widens pino's Logger to FastifyBaseLogger. Without it the
    // FastifyInstance generic is parameterised on pino's type and stops being
    // assignable to a plain FastifyInstance, which would force the same generic
    // through every route module for no benefit.
    loggerInstance: ctx.log as FastifyBaseLogger,
    // Every request gets an id, propagated from the edge when one is supplied,
    // so a single telemetry report can be followed across the API, the stream
    // processor and the worker in one log query.
    genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
    disableRequestLogging: false,
    trustProxy: true,
    bodyLimit: 1_048_576,
  });

  await app.register(cors, {
    origin: ctx.config.CORS_ORIGIN === '*' ? true : ctx.config.CORS_ORIGIN.split(','),
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  });

  // The OpenAPI document is the contract between this service and the web
  // client. It is generated from the routes rather than maintained by hand, so
  // it cannot describe an endpoint that no longer exists.
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Open Aviation Telemetry API',
        description:
          'Telemetry ingestion, fleet state, alerting and asynchronous report generation.',
        version: '0.1.0',
        license: { name: 'Apache-2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
      },
      tags: [
        { name: 'telemetry', description: 'Ingestion' },
        { name: 'fleet', description: 'Aircraft, history and alerts' },
        { name: 'reports', description: 'Asynchronous report generation' },
        { name: 'demo', description: 'Demonstration control and fault injection' },
        { name: 'ops', description: 'Probes, metrics and infrastructure' },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  /**
   * Accept an empty body on a JSON request.
   *
   * Several endpoints take no arguments — stopping the demo, injecting a
   * scenario — and a client that sends `content-type: application/json` with no
   * body is being perfectly reasonable. Fastify's default parser rejects that
   * with FST_ERR_CTP_EMPTY_JSON_BODY, which surfaces as a confusing 400 on a
   * request that was fine. Treating an empty body as an empty object is both
   * what the caller meant and what the route handlers already expect.
   */
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_request, body: string, done) => {
      if (!body || body.trim() === '') {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(body));
      } catch (err) {
        const error = err as Error & { statusCode?: number };
        error.statusCode = 400;
        done(error, undefined);
      }
    },
  );

  app.addHook('onRequest', async (request) => {
    (request as { startTime?: bigint }).startTime = process.hrtime.bigint();
  });

  app.addHook('onResponse', async (request, reply) => {
    const start = (request as { startTime?: bigint }).startTime;
    if (start !== undefined) {
      ctx.metrics.observeLatency(Number(process.hrtime.bigint() - start) / 1_000_000);
    }
    ctx.metrics.increment(METRIC.httpRequests);
    if (reply.statusCode >= 500) ctx.metrics.increment(METRIC.httpErrors);
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    const err = error as { statusCode?: number; code?: string; message?: string };
    const statusCode = err.statusCode ?? 500;

    // A 4xx is the caller's problem and telling them exactly what was wrong is
    // the whole point. A 5xx is ours, and its message may name internals, so the
    // client gets a request id instead and the detail stays in the logs.
    if (statusCode < 500) {
      request.log.warn({ err: error, url: request.url }, 'rejected request');
      reply.status(statusCode).send({
        error: err.code ?? 'bad_request',
        message: err.message ?? 'The request could not be processed.',
        request_id: request.id,
      });
      return;
    }

    request.log.error({ err: error, url: request.url }, 'unhandled request error');
    ctx.metrics.increment(METRIC.httpErrors);
    reply.status(500).send({
      error: 'internal_error',
      message: 'The request could not be completed.',
      request_id: request.id,
    });
  });

  app.get('/', async () => ({
    service: 'open-aviation-telemetry',
    description: 'An AWS reference architecture for aircraft telemetry.',
    docs: '/docs',
    openapi: '/docs/json',
    health: '/health',
    ready: '/ready',
    metrics: '/metrics',
    repository: 'https://github.com/parker-brown-family/open-aviation-telemetry',
  }));

  await registerOpsRoutes(app, ctx);
  await registerFleetRoutes(app, ctx);

  return app;
}
