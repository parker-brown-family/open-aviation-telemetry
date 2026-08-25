import { TOPICS, type TelemetryReport } from '@oat/shared';

/**
 * Helpers for the end-to-end suite.
 *
 * Everything here talks to the running system over HTTP only. The tests
 * deliberately have no database connection and no broker client: if an
 * assertion can only be satisfied by the real pipeline having run, then a pass
 * means the real pipeline ran.
 */

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:8080';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    url: string,
  ) {
    super(`${url} responded ${status}: ${body.slice(0, 300)}`);
    this.name = 'HttpError';
  }
}

export async function call<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T }> {
  // Only declare a JSON content type when there is actually a body. Sending the
  // header with no body is a real thing clients do, and the API tolerates it —
  // but the tests should exercise the ordinary case by default.
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body !== undefined && headers['content-type'] === undefined) {
    headers['content-type'] = 'application/json';
  }

  const response = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  const text = await response.text();
  let body: T;
  try {
    body = text ? (JSON.parse(text) as T) : (undefined as T);
  } catch {
    body = text as unknown as T;
  }
  return { status: response.status, body };
}

export async function expectOk<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { status, body } = await call<T>(path, init);
  if (status < 200 || status >= 300) {
    throw new HttpError(status, JSON.stringify(body), path);
  }
  return body;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Polls until a condition holds.
 *
 * Every asynchronous assertion in this suite goes through here rather than a
 * fixed sleep, so the tests are as fast as the system is and do not silently
 * become flaky when it is slower under load.
 */
export async function eventually<T>(
  description: string,
  probe: () => Promise<T>,
  predicate: (value: T) => boolean,
  { timeoutMs = 45_000, intervalMs = 500 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      last = await probe();
      if (predicate(last)) return last;
    } catch (err) {
      lastError = err;
    }
    await sleep(intervalMs);
  }

  const detail = lastError
    ? `last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`
    : `last value: ${JSON.stringify(last).slice(0, 400)}`;
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}. ${detail}`);
}

/** A unique aircraft id per test run, so runs cannot interfere with each other. */
export function uniqueAircraftId(prefix = 'E2E'): string {
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `C-${prefix}${suffix}`;
}

export function telemetry(
  aircraftId: string,
  overrides: Partial<TelemetryReport> = {},
): Record<string, unknown> {
  return {
    aircraft_id: aircraftId,
    timestamp: new Date().toISOString(),
    position: { latitude: 49.9561, longitude: -119.3777 },
    altitude_ft: 24000,
    groundspeed_kts: 360,
    heading_deg: 78,
    vertical_rate_fpm: 0,
    engine: { temperature_c: 92, rpm: 2200 },
    fuel_remaining_kg: 2400,
    ...overrides,
  };
}

export const TELEMETRY_TOPIC = TOPICS.telemetry;
