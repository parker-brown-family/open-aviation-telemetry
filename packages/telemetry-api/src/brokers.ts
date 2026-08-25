import { randomUUID } from 'node:crypto';
import amqp from 'amqplib';
import { Kafka, Partitioners, type Producer } from 'kafkajs';
import { assertJobTopology, buildKafkaOptions } from '@oat/service-kit';
import {
  RABBIT,
  TOPICS,
  partitionKeyFor,
  type EventEnvelope,
  type ReportJob,
  type TelemetryReport,
} from '@oat/shared';
import type { Config } from './config.js';
import type { Logger } from './logger.js';

/**
 * Broker clients that start disconnected and heal on their own.
 *
 * The API process must be able to start while Kafka or RabbitMQ is still coming
 * up — otherwise a broker restart turns into a crash loop across every replica.
 * So connection failure is not fatal: the process runs, /health stays up so
 * Kubernetes does not kill it, /ready goes false so it is removed from the load
 * balancer, and a background loop keeps trying.
 */

export interface Connectable {
  readonly name: string;
  isReady(): boolean;
  lastError(): string | null;
  close(): Promise<void>;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

function backoffMs(attempt: number): number {
  const exponential = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
  // Full jitter: without it, every replica retries in lockstep and hammers a
  // broker that is already struggling.
  return Math.random() * exponential;
}

// ---------------------------------------------------------------------------
// Kafka
// ---------------------------------------------------------------------------

export interface ConsumerLag {
  topic: string;
  group: string;
  /** Sum of (log end offset - committed offset) across partitions. */
  total_lag: number;
  partitions: { partition: number; end_offset: number; committed_offset: number; lag: number }[];
}

export class KafkaPublisher implements Connectable {
  readonly name = 'kafka';
  private kafka: Kafka | null = null;
  private producer: Producer | null = null;
  private ready = false;
  private error: string | null = null;
  private stopped = false;
  private attempt = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: Config,
    private readonly log: Logger,
  ) {}

  isReady(): boolean {
    return this.ready;
  }

  lastError(): string | null {
    return this.error;
  }

  /** Kicks off connection and keeps retrying in the background. Never throws. */
  start(): void {
    void this.attemptConnect();
  }

  private async attemptConnect(): Promise<void> {
    if (this.stopped) return;
    try {
      const kafka = new Kafka(
        await buildKafkaOptions({
          clientId: this.config.KAFKA_CLIENT_ID,
          brokers: this.config.KAFKA_BROKERS,
          auth: this.config.KAFKA_AUTH,
          region: this.config.AWS_REGION,
        }),
      );
      const producer = kafka.producer({
        allowAutoTopicCreation: true,
        idempotent: false,
        // Chosen explicitly rather than left to default. This partitioner hashes
        // the key with murmur2, which is what the Java client does — so a
        // consumer written in any language lands on the same partition for a
        // given aircraft_id. Since ordering per airframe is the reason the key
        // exists at all, this is not a detail to leave implicit.
        createPartitioner: Partitioners.DefaultPartitioner,
      });
      producer.on(producer.events.DISCONNECT, () => {
        this.ready = false;
        this.error = 'producer disconnected';
        this.log.warn('kafka producer disconnected, will retry');
        this.scheduleRetry();
      });
      await producer.connect();
      this.kafka = kafka;
      this.producer = producer;
      this.ready = true;
      this.error = null;
      this.attempt = 0;
      this.log.info({ brokers: this.config.KAFKA_BROKERS }, 'kafka producer connected');
    } catch (err) {
      this.ready = false;
      this.error = err instanceof Error ? err.message : String(err);
      this.log.warn({ err: this.error, attempt: this.attempt }, 'kafka connect failed');
      this.scheduleRetry();
    }
  }

  private scheduleRetry(): void {
    if (this.stopped || this.timer) return;
    const delay = backoffMs(this.attempt++);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.attemptConnect();
    }, delay);
    this.timer.unref();
  }

  /**
   * Publishes one telemetry event.
   *
   * Keyed by aircraft_id so every report for an airframe lands on one partition
   * and is therefore processed in order.
   */
  async publishTelemetry(report: TelemetryReport): Promise<EventEnvelope> {
    if (!this.producer || !this.ready) {
      throw new Error(`kafka unavailable: ${this.error ?? 'not connected'}`);
    }
    const envelope: EventEnvelope = {
      event_id: randomUUID(),
      event_type: 'aircraft.telemetry.reported',
      schema_version: 1,
      occurred_at: new Date().toISOString(),
      aircraft_id: report.aircraft_id,
      payload: report,
    };
    await this.producer.send({
      topic: TOPICS.telemetry,
      messages: [
        {
          key: partitionKeyFor(report.aircraft_id),
          value: JSON.stringify(envelope),
          headers: { event_type: envelope.event_type, schema_version: '1' },
        },
      ],
    });
    return envelope;
  }

  /**
   * Publishes an intentionally malformed message so the consumer's quarantine
   * path can be demonstrated. Only reachable from the demo routes.
   */
  async publishPoison(): Promise<void> {
    if (!this.producer || !this.ready) throw new Error('kafka unavailable');
    await this.producer.send({
      topic: TOPICS.telemetry,
      messages: [
        {
          key: 'POISON',
          value: JSON.stringify({ event_type: 'aircraft.telemetry.reported', broken: true }),
          headers: { event_type: 'aircraft.telemetry.reported', schema_version: '1' },
        },
      ],
    });
  }

  /**
   * Consumer lag, read from the broker: log end offset minus committed offset,
   * per partition. This is the number that tells you whether the processing tier
   * is keeping up, and it is the honest way to show a burst being absorbed —
   * lag climbs, then drains, and you can watch it happen.
   */
  async consumerLag(topic: string, groupId: string): Promise<ConsumerLag | null> {
    if (!this.kafka || !this.ready) return null;
    const admin = this.kafka.admin();
    try {
      await admin.connect();
      const [endOffsets, committed] = await Promise.all([
        admin.fetchTopicOffsets(topic),
        admin.fetchOffsets({ groupId, topics: [topic] }),
      ]);
      const committedByPartition = new Map<number, string>(
        (committed[0]?.partitions ?? []).map((p) => [p.partition, p.offset]),
      );

      const partitions = endOffsets.map((p) => {
        const end = Number(p.offset);
        const raw = committedByPartition.get(p.partition);
        // -1 means the group has never committed for this partition.
        const commit = raw === undefined || raw === '-1' ? 0 : Number(raw);
        return {
          partition: p.partition,
          end_offset: end,
          committed_offset: commit,
          lag: Math.max(0, end - commit),
        };
      });

      return {
        topic,
        group: groupId,
        total_lag: partitions.reduce((sum, p) => sum + p.lag, 0),
        partitions,
      };
    } catch {
      return null;
    } finally {
      await admin.disconnect().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.ready = false;
    await this.producer?.disconnect().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// RabbitMQ
// ---------------------------------------------------------------------------

export class RabbitPublisher implements Connectable {
  readonly name = 'rabbitmq';
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.Channel | null = null;
  private ready = false;
  private error: string | null = null;
  private stopped = false;
  private attempt = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: Config,
    private readonly log: Logger,
  ) {}

  isReady(): boolean {
    return this.ready;
  }

  lastError(): string | null {
    return this.error;
  }

  start(): void {
    void this.attemptConnect();
  }

  private async attemptConnect(): Promise<void> {
    if (this.stopped) return;
    try {
      const connection = await amqp.connect(this.config.RABBITMQ_URL);
      connection.on('error', (err: Error) => {
        this.ready = false;
        this.error = err.message;
      });
      connection.on('close', () => {
        this.ready = false;
        this.error = this.error ?? 'connection closed';
        this.log.warn('rabbitmq connection closed, will retry');
        this.scheduleRetry();
      });

      const channel = await connection.createChannel();
      await assertJobTopology(channel);

      this.connection = connection;
      this.channel = channel;
      this.ready = true;
      this.error = null;
      this.attempt = 0;
      this.log.info('rabbitmq publisher connected');
    } catch (err) {
      this.ready = false;
      this.error = err instanceof Error ? err.message : String(err);
      this.log.warn({ err: this.error, attempt: this.attempt }, 'rabbitmq connect failed');
      this.scheduleRetry();
    }
  }

  private scheduleRetry(): void {
    if (this.stopped || this.timer) return;
    const delay = backoffMs(this.attempt++);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.attemptConnect();
    }, delay);
    this.timer.unref();
  }

  /** Enqueues a report job. Persistent, so a broker restart does not lose it. */
  async enqueueReport(job: ReportJob): Promise<void> {
    if (!this.channel || !this.ready) {
      throw new Error(`rabbitmq unavailable: ${this.error ?? 'not connected'}`);
    }
    this.channel.publish(
      RABBIT.exchange,
      RABBIT.reportRoutingKey,
      Buffer.from(JSON.stringify(job)),
      { persistent: true, contentType: 'application/json', messageId: job.job_id },
    );
  }

  /** Live queue depth, straight from the broker — not an estimate. */
  async queueDepth(): Promise<{ pending: number; dead_lettered: number } | null> {
    if (!this.channel || !this.ready) return null;
    try {
      const main = await this.channel.checkQueue(RABBIT.reportQueue);
      const dlq = await this.channel.checkQueue(RABBIT.reportDlq);
      return { pending: main.messageCount, dead_lettered: dlq.messageCount };
    } catch {
      return null;
    }
  }

  async close(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.ready = false;
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }
}
