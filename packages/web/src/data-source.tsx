import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from './api.js';
import { SAMPLE } from './sample-data.js';

/**
 * Where the numbers on screen came from.
 *
 * This is the honesty layer, and it is deliberately not optional. This client is
 * published as a static page at a public URL where no API is attached, and it is
 * also run locally against the full stack. Those two situations must never look
 * the same.
 *
 *   live    — a real API answered. Everything on screen was measured.
 *   sample  — no API is reachable. Everything on screen is a recorded snapshot
 *             committed to the repository. Nothing is being measured.
 *   probing — we have not found out yet.
 *
 * The mode is displayed permanently in the header, not tucked into a tooltip,
 * because a dashboard that shows plausible fabricated numbers without saying so
 * is worse than one that shows nothing.
 */
export type DataMode = 'probing' | 'live' | 'sample';

export interface DataSource {
  mode: DataMode;
  /** Base URL the client is configured to call, for display. */
  apiBaseUrl: string;
  /** Why we fell back, when we did. */
  reason: string | null;
  /** Re-probe, e.g. after starting the stack locally. */
  recheck: () => void;
  client: typeof api;
}

const DataSourceContext = createContext<DataSource | null>(null);

const configuredBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

/**
 * A client that serves the committed sample snapshot.
 *
 * Read operations return the fixture. Write operations reject, rather than
 * pretending to succeed — a Start button that appears to work while nothing
 * happens is exactly the kind of thing this whole module exists to prevent.
 */
const sampleUnavailable = (): Promise<never> =>
  Promise.reject(
    new ApiError('Not available in sample mode — no API is attached to this page.', 503),
  );

const sampleClient: typeof api = {
  stats: () => Promise.resolve(SAMPLE.stats),
  infrastructure: () => Promise.resolve(SAMPLE.infrastructure),
  aircraft: () => Promise.resolve({ count: SAMPLE.aircraft.length, aircraft: SAMPLE.aircraft }),
  aircraftById: (id) => {
    const found = SAMPLE.aircraft.find((a) => a.aircraft_id === id);
    return found ? Promise.resolve(found) : Promise.reject(new ApiError('not found', 404));
  },
  history: (id) =>
    Promise.resolve({
      count: SAMPLE.history[id]?.length ?? 0,
      telemetry: SAMPLE.history[id] ?? [],
    }),
  alerts: () => Promise.resolve({ count: SAMPLE.alerts.length, alerts: SAMPLE.alerts }),
  reports: () => Promise.resolve({ count: SAMPLE.reports.length, reports: SAMPLE.reports }),
  report: (id) => {
    const found = SAMPLE.reports.find((r) => r.report_id === id);
    return found ? Promise.resolve(found) : Promise.reject(new ApiError('not found', 404));
  },
  requestReport: sampleUnavailable,
  demoStatus: () => Promise.resolve(SAMPLE.demoStatus),
  demoStart: sampleUnavailable,
  demoStop: sampleUnavailable,
  demoReset: sampleUnavailable,
  scenario: sampleUnavailable,
};

export function DataSourceProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [mode, setMode] = useState<DataMode>('probing');
  const [reason, setReason] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const probe = async (): Promise<void> => {
      try {
        // A short timeout: if there is no API here, the page should settle into
        // sample mode quickly rather than showing a spinner for ten seconds.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        const response = await fetch(`${configuredBase}/api/v1/stats`, {
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!response.ok) {
          throw new Error(
            `the API at ${configuredBase || 'this origin'} responded ${response.status}`,
          );
        }

        // A static host answers /api/v1/stats with its own index.html rather
        // than a 404, so a 200 is not enough — the body has to actually be the
        // stats document. Reporting the raw JSON parse error here would show a
        // visitor "Unexpected token '<'", which explains nothing.
        const body: unknown = await response.json().catch(() => {
          throw new Error('no API is serving this address — the response was not JSON');
        });
        if (typeof body !== 'object' || body === null || !('fleet' in body)) {
          throw new Error('the response did not look like this API');
        }

        if (cancelled) return;
        setMode('live');
        setReason(null);
      } catch (err) {
        if (cancelled) return;
        setMode('sample');
        const message = err instanceof Error ? err.message : String(err);
        // A network-level failure is the ordinary case for a published static
        // page. Say so in words rather than passing on the browser's wording.
        setReason(
          /failed to fetch|networkerror|load failed|aborted/i.test(message)
            ? 'no API responded at this address'
            : message,
        );
      }
    };

    void probe();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const value = useMemo<DataSource>(
    () => ({
      mode,
      apiBaseUrl: configuredBase || window.location.origin,
      reason,
      recheck: () => setAttempt((a) => a + 1),
      // While probing, serve the sample so the layout renders immediately; the
      // banner says "checking", so nothing is claimed to be live yet.
      client: mode === 'live' ? api : sampleClient,
    }),
    [mode, reason],
  );

  return <DataSourceContext.Provider value={value}>{children}</DataSourceContext.Provider>;
}

export function useDataSource(): DataSource {
  const context = useContext(DataSourceContext);
  if (!context) throw new Error('useDataSource must be used inside a DataSourceProvider');
  return context;
}
