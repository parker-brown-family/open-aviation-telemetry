import { z } from 'zod';
import { TelemetryReportSchema } from './telemetry.js';

/**
 * Kafka topic names carry an explicit schema version. A breaking change to the
 * payload creates `.v2` and runs both topics until consumers have migrated —
 * consumers are never forced to upgrade in lockstep with producers.
 */
export const TOPICS = {
  telemetry: 'aircraft.telemetry.v1',
  /** Events the processor could not handle are parked here, never silently dropped. */
  telemetryDlq: 'aircraft.telemetry.v1.dlq',
} as const;

export const CONSUMER_GROUPS = {
  telemetryProcessors: 'telemetry-processors',
} as const;

/**
 * Every event is wrapped in the same envelope. `event_id` is what makes
 * at-least-once delivery survivable: the consumer records processed ids and
 * skips replays, so redelivery is a non-event rather than duplicate state.
 */
export const EventEnvelopeSchema = z.object({
  event_id: z.string().uuid(),
  event_type: z.literal('aircraft.telemetry.reported'),
  schema_version: z.literal(1),
  occurred_at: z.string().datetime({ offset: true }),
  /** Also used as the Kafka message key — see partitioning note below. */
  aircraft_id: z.string(),
  payload: TelemetryReportSchema,
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

/**
 * Partition key = aircraft_id.
 *
 * Every report for one airframe lands on one partition, so that airframe's
 * events are processed in order. Different airframes are independent, so the
 * fleet still processes in parallel across partitions. Ordering where it
 * matters, concurrency everywhere else.
 */
export function partitionKeyFor(aircraftId: string): string {
  return aircraftId;
}

export function isReplay(processedIds: ReadonlySet<string>, envelope: EventEnvelope): boolean {
  return processedIds.has(envelope.event_id);
}
