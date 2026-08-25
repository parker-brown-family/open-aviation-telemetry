import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { SAMPLE } from '../sample-data.js';
import { renderWithProviders, stubApiOffline } from '../test-utils.js';
import { Dashboard } from './Dashboard.js';

/**
 * The dashboard.
 *
 * The page prints a paragraph describing where its numbers come from, and that
 * paragraph changes with the data source. Getting it wrong is the worst
 * available outcome for this project — a dashboard asserting "every figure is
 * measured" over a bundled snapshot is precisely the quiet untruth the whole
 * data-source layer exists to prevent — and it is a single ternary away at all
 * times. So both branches are pinned.
 */

const liveBody = { ...SAMPLE.stats, fleet: SAMPLE.stats.fleet };

function stubLive(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Promise.resolve(
        new Response(JSON.stringify(liveBody), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('what the page claims about its own numbers', () => {
  it('does not claim measurement when running on the snapshot', async () => {
    stubApiOffline();
    renderWithProviders(<Dashboard />);
    expect(await screen.findByText(/from the bundled sample dataset/)).toBeInTheDocument();
    expect(screen.queryByText(/^Live operational picture/)).toBeNull();
  });

  it('claims measurement only when an API actually answered', async () => {
    stubLive();
    renderWithProviders(<Dashboard />);
    await waitFor(() => expect(screen.getByText(/Live operational picture/)).toBeInTheDocument());
    expect(screen.queryByText(/from the bundled sample dataset/)).toBeNull();
  });

  it('does not show a stats error banner in sample mode', async () => {
    // Nothing failed; there is simply no API. An error banner would report a
    // fault that did not occur.
    stubApiOffline();
    renderWithProviders(<Dashboard />);
    await screen.findByText(/from the bundled sample dataset/);
    expect(screen.queryByText(/Stats unavailable/)).toBeNull();
  });
});

describe('the stat tiles', () => {
  beforeEach(() => {
    stubApiOffline();
  });

  it('shows every headline figure', async () => {
    renderWithProviders(<Dashboard />);
    for (const label of [
      'Active aircraft',
      'Telemetry / min',
      'Consumer lag',
      'Queue depth',
      'Critical alerts',
      'API p95',
    ]) {
      expect(await screen.findByText(label), `${label} tile is missing`).toBeInTheDocument();
    }
  });

  it('reads the active-aircraft count from the data source', async () => {
    renderWithProviders(<Dashboard />);
    // .closest('.tile'), not '.tile, div': the label is itself a div, so a
    // selector list including div matches the label and never reaches the tile.
    const tile = (await screen.findByText('Active aircraft')).closest('.tile') as HTMLElement;
    await waitFor(() =>
      expect(within(tile).getByText(String(SAMPLE.stats.fleet.aircraft_active))).toBeVisible(),
    );
  });
});

describe('the plan view', () => {
  beforeEach(() => {
    stubApiOffline();
  });

  it('plots the tracked aircraft', async () => {
    renderWithProviders(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByText(`${SAMPLE.aircraft.length} tracked`)).toBeVisible(),
    );
  });

  it('draws a marker for each aircraft rather than an empty scope', async () => {
    const { container } = renderWithProviders(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Plan view')).toBeVisible());
    await waitFor(() =>
      expect(container.querySelectorAll('.pv-hit').length).toBe(SAMPLE.aircraft.length),
    );
  });
});

describe('recent alerts', () => {
  beforeEach(() => {
    stubApiOffline();
  });

  it('lists alerts and links out to the full page', async () => {
    renderWithProviders(<Dashboard />);
    await screen.findByText('Recent alerts');
    expect(screen.getByRole('link', { name: 'All alerts' })).toHaveAttribute('href', '/alerts');
  });

  it('shows at most eight, however many are raised', async () => {
    // The dashboard is a summary; the alerts page is the list.
    renderWithProviders(<Dashboard />);
    const panel = (await screen.findByText('Recent alerts')).closest('.panel') as HTMLElement;
    await waitFor(() => expect(within(panel).queryAllByRole('row').length).toBeGreaterThan(0));
    const rows = within(panel).getAllByRole('row').slice(1);
    expect(rows.length).toBeLessThanOrEqual(8);
  });
});

describe('the pipeline panel', () => {
  beforeEach(() => {
    stubApiOffline();
  });

  it('names the topic and consumer group it is reading', async () => {
    renderWithProviders(<Dashboard />);
    const panel = (await screen.findByText('Pipeline')).closest('.panel') as HTMLElement;
    await waitFor(() => expect(within(panel).getByText(SAMPLE.stats.stream.topic)).toBeVisible());
    expect(within(panel).getByText(SAMPLE.stats.stream.consumer_group)).toBeInTheDocument();
  });

  it('reports broker connectivity as a status rather than a bare boolean', async () => {
    renderWithProviders(<Dashboard />);
    const panel = (await screen.findByText('Pipeline')).closest('.panel') as HTMLElement;
    await waitFor(() =>
      expect(within(panel).getAllByText(/connected|disconnected/).length).toBeGreaterThanOrEqual(2),
    );
  });
});
