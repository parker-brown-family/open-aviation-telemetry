import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { ALERT_LABELS, THRESHOLDS, type AlertKind } from '@oat/shared';
import { SAMPLE } from '../sample-data.js';
import { renderWithProviders, stubApiOffline } from '../test-utils.js';
import { Alerts } from './Alerts.js';

/**
 * The alerts page.
 *
 * The assertion worth having here is the anti-drift one. The page claims the
 * detection rules it prints "cannot drift away from the implementation" because
 * they are imported from the same constants the stream processor evaluates.
 * That claim is only true for as long as somebody keeps importing them, and it
 * is exactly the kind of thing that gets quietly replaced with a hard-coded
 * number during a hurried edit. So it is checked rather than trusted.
 */

beforeEach(() => {
  stubApiOffline();
});

afterEach(() => {
  document.body.innerHTML = '';
});

const rulesTable = async (): Promise<HTMLElement> => {
  const heading = await screen.findByText('Detection rules');
  return heading.closest('.panel') as HTMLElement;
};

describe('the detection rules table', () => {
  it('prints every alert kind the shared module defines', async () => {
    // A kind added to the processor but not to this table is a rule that fires
    // in production and is documented nowhere.
    renderWithProviders(<Alerts />);
    const panel = await rulesTable();
    for (const label of Object.values(ALERT_LABELS)) {
      expect(within(panel).getByText(label), `${label} is not documented`).toBeInTheDocument();
    }
  });

  it('quotes the same threshold values the processor evaluates', async () => {
    renderWithProviders(<Alerts />);
    const panel = await rulesTable();
    const text = panel.textContent ?? '';

    // Each of these appears in the rule text; if a constant changes and the
    // table is hard-coded instead of imported, this fails.
    expect(text).toContain(String(THRESHOLDS.engineTempWarningC));
    expect(text).toContain(String(THRESHOLDS.engineTempCriticalC));
    expect(text).toContain(String(THRESHOLDS.engineRpmMin));
    expect(text).toContain(String(THRESHOLDS.engineRpmMax));
    expect(text).toContain(String(THRESHOLDS.airborneAltitudeFt));
    expect(text).toContain(String(Math.abs(THRESHOLDS.rapidDescentFpm)));
    expect(text).toContain(String(THRESHOLDS.highSpeedKts));
    expect(text).toContain(String(THRESHOLDS.lowAltitudeFt));
    expect(text).toContain(String(THRESHOLDS.fuelLowKg));
    expect(text).toContain(String(THRESHOLDS.telemetryGapMs / 1000));
  });

  it('states the rule in words for every kind it lists', async () => {
    renderWithProviders(<Alerts />);
    const panel = await rulesTable();
    const rows = within(panel).getAllByRole('row').slice(1); // drop the header
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const cells = within(row).getAllByRole('cell');
      expect(cells).toHaveLength(2);
      expect(cells[1]!.textContent?.trim().length, 'a rule has no description').toBeGreaterThan(5);
    }
  });
});

describe('the alerts table', () => {
  it('shows each alert from the data source', async () => {
    renderWithProviders(<Alerts />);
    await waitFor(() => expect(screen.getByText(`Alerts (${SAMPLE.alerts.length})`)).toBeVisible());
    for (const alert of SAMPLE.alerts) {
      expect(screen.getAllByText(alert.aircraft_id).length).toBeGreaterThan(0);
      // getAll: two airframes can legitimately raise the same message.
      expect(screen.getAllByText(alert.message).length).toBeGreaterThan(0);
    }
  });

  it('translates the alert kind into the shared label rather than the raw enum', async () => {
    renderWithProviders(<Alerts />);
    await screen.findByText(`Alerts (${SAMPLE.alerts.length})`);
    for (const alert of SAMPLE.alerts) {
      const label = ALERT_LABELS[alert.kind as AlertKind];
      if (label) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('links each alert to that airframe on the fleet page', async () => {
    // An operator reading an alert wants the aircraft, not a copy-pasteable id.
    renderWithProviders(<Alerts />);
    await screen.findByText(`Alerts (${SAMPLE.alerts.length})`);
    const first = SAMPLE.alerts[0]!;
    const link = screen.getAllByRole('link', { name: first.aircraft_id })[0]!;
    expect(link).toHaveAttribute(
      'href',
      `/fleet?aircraft=${encodeURIComponent(first.aircraft_id)}`,
    );
  });
});

describe('the reports table', () => {
  it('shows each report from the data source', async () => {
    renderWithProviders(<Alerts />);
    await waitFor(() =>
      expect(screen.getByText(`Reports (${SAMPLE.reports.length})`)).toBeVisible(),
    );
    for (const report of SAMPLE.reports) {
      expect(screen.getAllByText(report.aircraft_id).length).toBeGreaterThan(0);
    }
  });

  it('shows a dash rather than a zero for a report with no payload yet', async () => {
    // A queued report has no samples. Printing 0 would claim it ran and found
    // nothing, which is a different fact entirely.
    renderWithProviders(<Alerts />);
    await screen.findByText(`Reports (${SAMPLE.reports.length})`);
    const pending = SAMPLE.reports.filter((r) => !r.payload);
    if (pending.length > 0) {
      expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(pending.length);
    }
  });
});

describe('honesty about the source', () => {
  it('does not show a live-API error banner when running on the sample snapshot', async () => {
    // In sample mode nothing failed — there is simply no API. Showing "Alerts
    // unavailable" would be reporting an error that did not happen.
    renderWithProviders(<Alerts />);
    await screen.findByText('Detection rules');
    expect(screen.queryByText(/Alerts unavailable/)).toBeNull();
  });

  it('explains that alerts are derived rather than reported by the aircraft', async () => {
    renderWithProviders(<Alerts />);
    expect(
      await screen.findByText(/derived by the stream processor from raw telemetry/),
    ).toBeInTheDocument();
  });
});
