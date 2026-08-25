import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import type { ReactNode } from 'react';
import { DataSourceProvider } from './data-source.js';

/**
 * Test helpers.
 *
 * The important one is `stubApi`: the whole data-source layer is built on a
 * single probe request, so controlling `fetch` is how a test decides whether the
 * component under test believes it is live or offline.
 */

/**
 * Makes every fetch succeed with a stats-shaped body.
 *
 * The probe checks for a `fleet` key, not just a 200, because a static host
 * answers an unknown path with its own index.html rather than a 404. The
 * default here therefore has to look like the real document.
 */
export function stubApiOnline(
  payload: unknown = { measured: true, fleet: { aircraft_total: 0 } },
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  );
}

/**
 * A 200 whose body is HTML — what a static file server returns for a path it
 * does not know about. This is the exact situation the published page is in.
 */
export function stubApiServingHtml(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Promise.resolve(
        new Response('<!DOCTYPE html><html><body>index</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    ),
  );
}

/** Makes every fetch fail, as it would on a static page with no API behind it. */
export function stubApiOffline(message = 'Failed to fetch'): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Promise.reject(new Error(message))),
  );
}

/** Makes fetch return a non-2xx response, e.g. a misconfigured reverse proxy. */
export function stubApiStatus(status: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Promise.resolve(new Response('nope', { status }))),
  );
}

export function renderWithProviders(
  ui: ReactNode,
  { route = '/' }: { route?: string } = {},
): RenderResult {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <DataSourceProvider>{ui}</DataSourceProvider>
    </MemoryRouter>,
  );
}
