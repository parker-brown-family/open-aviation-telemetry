import {
  EventEnvelopeSchema,
  deriveFlightPhase,
  detectAnomalies,
  type DetectedAnomaly,
  type EventEnvelope,
  type TelemetryReport,
} from '@oat/shared';

/**
 * Per-airframe state held in memory by the consumer.
 *
 * This is safe *because of* the partition key. Every report for one aircraft is
 * keyed by aircraft_id, so every report for that aircraft lands on the same
 * partition, and a partition is owned by exactly one consumer in the group. One
 * consumer therefore sees that airframe's whole ordered history and can keep
 * local state for it without coordination.
 *
 * Change the partition key and this becomes wrong — which is a good example of
 * why the key is an architectural decision and not a detail.
 *
 * On rebalance the new owner starts with a cold cache and simply cannot detect
 * gap-based anomalies until it has seen two reports. That is an acceptable loss
 * for a derived signal; anything that must survive rebalancing lives in
 * PostgreSQL instead.
 */
export class RecentStateCache {
  private readonly entries = new Map<string, TelemetryReport>();

  constructor(private readonly capacity = 5000) {}

  get(aircraftId: string): TelemetryReport | null {
    return this.entries.get(aircraftId) ?? null;
  }

  set(aircraftId: string, report: TelemetryReport): void {
    // Re-insert to move the key to the end of Map's insertion order, so the
    // eviction below always drops the least recently updated airframe.
    this.entries.delete(aircraftId);
    this.entries.set(aircraftId, report);
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

export type ParseOutcome =
  { ok: true; envelope: EventEnvelope } | { ok: false; reason: string; detail: string };

/**
 * Parses and validates a raw Kafka message value.
 *
 * A message that fails here can never succeed, no matter how many times it is
 * retried — the bytes will not change. So it is quarantined rather than retried,
 * which is the whole point of a dead-letter topic: a single malformed message
 * must not be able to stall the partition behind it indefinitely.
 */
export function parseEnvelope(raw: Buffer | string | null): ParseOutcome {
  if (raw === null) {
    return { ok: false, reason: 'empty_message', detail: 'message had no value' };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw.toString());
  } catch (err) {
    return {
      ok: false,
      reason: 'invalid_json',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const parsed = EventEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'schema_violation',
      detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }

  return { ok: true, envelope: parsed.data };
}

export interface DerivedState {
  flight_phase: string;
  anomalies: DetectedAnomaly[];
}

/**
 * The derivation step: raw telemetry plus what came before it becomes a flight
 * phase and a set of anomalies.
 *
 * Pure, and separated from every I/O concern in this service, so the rules can
 * be tested against a table of inputs rather than by standing up a broker.
 */
export function derive(report: TelemetryReport, previous: TelemetryReport | null): DerivedState {
  return {
    flight_phase: deriveFlightPhase(report),
    anomalies: detectAnomalies(report, { previous }),
  };
}

/**
 * Guards against an out-of-order report corrupting derived state.
 *
 * Kafka guarantees order within a partition, but a producer retry can still put
 * an older reading behind a newer one, and a rebalance can replay from the last
 * commit. Comparing timestamps is cheap insurance.
 */
export function isNewerThanCached(
  report: TelemetryReport,
  cached: TelemetryReport | null,
): boolean {
  if (!cached) return true;
  return Date.parse(report.timestamp) >= Date.parse(cached.timestamp);
}
