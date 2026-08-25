import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SCENARIOS } from '@oat/shared';
import { SAMPLE } from '../sample-data.js';
import { renderWithProviders, stubApiOffline } from '../test-utils.js';
import { DemoConsole } from './DemoConsole.js';

/**
 * The demo console.
 *
 * This page carries the sharpest version of the project's honesty rule: it is
 * published where nothing is running, so every control on it would do nothing
 * if clicked. A button that appears to work and silently does not is the exact
 * failure the data-source layer exists to prevent, so "the controls are
 * disabled, not merely ineffective" is asserted rather than assumed.
 */

/** A response that satisfies both the live probe and the demo-status call. */
const liveBody = {
  fleet: { aircraft_total: SAMPLE.aircraft.length },
  ...SAMPLE.demoStatus,
};

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

describe('with no API attached', () => {
  beforeEach(() => {
    stubApiOffline();
  });

  it('says plainly that the page is read-only, and why', async () => {
    renderWithProviders(<DemoConsole />);
    expect(await screen.findByText(/This page is read-only here/)).toBeInTheDocument();
    expect(screen.getByText(/disabled rather than appearing to work/)).toBeInTheDocument();
  });

  it('disables every control rather than letting them fail silently', async () => {
    renderWithProviders(<DemoConsole />);
    await screen.findByText(/This page is read-only here/);

    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button, `"${button.textContent}" is still clickable`).toBeDisabled();
    }
  });

  it('still documents every fault scenario, so the page is readable offline', async () => {
    // Disabled does not mean empty: the scenarios are the substance of the page
    // and are worth reading whether or not a stack is running.
    renderWithProviders(<DemoConsole />);
    await screen.findByText('Fault injection');
    expect(screen.getAllByRole('button', { name: 'Inject' })).toHaveLength(SCENARIOS.length);
  });

  it('explains what each scenario demonstrates and what to expect', async () => {
    renderWithProviders(<DemoConsole />);
    await screen.findByText('Fault injection');
    expect(screen.getAllByText(/Demonstrates:/).length).toBe(SCENARIOS.length);
    expect(screen.getAllByText(/Expect:/).length).toBe(SCENARIOS.length);
  });

  it('reports the simulator state from the snapshot', async () => {
    renderWithProviders(<DemoConsole />);
    await waitFor(() =>
      expect(
        screen.getByText(SAMPLE.demoStatus.state.running ? 'RUNNING' : 'STOPPED'),
      ).toBeVisible(),
    );
  });

  it('explains that injected faults change what the aircraft reports', async () => {
    // The architectural point: nothing writes an alert directly, so an alert on
    // screen is always something the processor derived.
    renderWithProviders(<DemoConsole />);
    expect(await screen.findByText(/it never writes an alert directly/)).toBeInTheDocument();
  });
});

describe('with a live API', () => {
  beforeEach(() => {
    stubLive();
  });

  it('drops the read-only notice', async () => {
    renderWithProviders(<DemoConsole />);
    await waitFor(() => expect(screen.queryByText(/This page is read-only here/)).toBeNull());
  });

  it('enables the controls', async () => {
    renderWithProviders(<DemoConsole />);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Inject' })[0]!).toBeEnabled(),
    );
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled();
  });

  it('confirms an action once it has actually completed', async () => {
    renderWithProviders(<DemoConsole />);
    const stop = await screen.findByRole('button', { name: 'Stop' });
    await waitFor(() => expect(stop).toBeEnabled());

    await userEvent.click(stop);
    expect(await screen.findByText('Stopped — done.')).toBeInTheDocument();
  });

  it('surfaces a failure instead of reporting success', async () => {
    renderWithProviders(<DemoConsole />);
    const stop = await screen.findByRole('button', { name: 'Stop' });
    await waitFor(() => expect(stop).toBeEnabled());

    // Fail only the action, after the page has settled into live mode.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('broker unreachable'))),
    );
    await userEvent.click(stop);

    expect(await screen.findByText(/broker unreachable/)).toBeInTheDocument();
    expect(screen.queryByText('Stopped — done.')).toBeNull();
  });
});
