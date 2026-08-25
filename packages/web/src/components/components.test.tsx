import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { REGION, type AircraftState } from '@oat/shared';
import { Empty, Panel, Pill, StatTile, num, since } from './primitives.js';
import { PlanView } from './PlanView.js';

describe('num', () => {
  it('renders an em dash for missing values rather than zero', () => {
    // Showing 0 for "we do not know" is a lie an operator would act on.
    expect(num(null)).toBe('—');
    expect(num(undefined)).toBe('—');
    expect(num(Number.NaN)).toBe('—');
  });

  it('renders zero as zero', () => {
    expect(num(0)).toBe('0');
  });

  it('groups thousands', () => {
    expect(num(1234567)).toBe('1,234,567');
  });

  it('honours a fraction-digit request', () => {
    expect(num(342.678, 1)).toBe('342.7');
  });
});

describe('since', () => {
  const now = Date.parse('2026-08-25T18:00:00.000Z');

  it('renders an em dash when there is no timestamp', () => {
    expect(since(null, now)).toBe('—');
  });

  it('renders seconds, minutes, hours and days', () => {
    expect(since('2026-08-25T17:59:48.000Z', now)).toBe('12s ago');
    expect(since('2026-08-25T17:45:00.000Z', now)).toBe('15m ago');
    expect(since('2026-08-25T15:00:00.000Z', now)).toBe('3h ago');
    expect(since('2026-08-23T18:00:00.000Z', now)).toBe('2d ago');
  });

  it('never renders a negative age for a clock slightly ahead', () => {
    expect(since('2026-08-25T18:00:05.000Z', now)).toBe('0s ago');
  });
});

describe('Pill', () => {
  it('derives its class from the status so a new status is styled neutrally', () => {
    const { container } = render(<Pill status="critical" />);
    expect(container.querySelector('.pill--critical')).toBeInTheDocument();
  });

  it('humanises an underscored status', () => {
    render(<Pill status="not_deployed" />);
    expect(screen.getByText('not deployed')).toBeInTheDocument();
  });

  it('renders explicit children when given', () => {
    render(<Pill status="healthy">connected</Pill>);
    expect(screen.getByText('connected')).toBeInTheDocument();
  });
});

describe('StatTile', () => {
  it('shows label, value and note', () => {
    render(<StatTile label="Active aircraft" value="42" note="3 stale" tone="cyan" />);
    expect(screen.getByText('Active aircraft')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('3 stale')).toBeInTheDocument();
  });

  it('omits the note element entirely when there is no note', () => {
    const { container } = render(<StatTile label="X" value="1" />);
    expect(container.querySelector('.tile__note')).toBeNull();
  });
});

describe('Panel and Empty', () => {
  it('renders a titled panel with its children', () => {
    render(
      <Panel title="Pipeline">
        <Empty>Nothing yet</Empty>
      </Panel>,
    );
    expect(screen.getByRole('heading', { name: 'Pipeline' })).toBeInTheDocument();
    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
  });
});

function aircraft(overrides: Partial<AircraftState> = {}): AircraftState {
  return {
    aircraft_id: 'C-GABC',
    callsign: 'OKA101',
    registration: 'C-GABC',
    type_icao: 'DH8D',
    operator: 'Okanagan Air',
    status: 'active',
    flight_phase: 'cruise',
    first_seen: '2026-08-25T17:00:00.000Z',
    last_seen: '2026-08-25T18:00:00.000Z',
    latest: {
      aircraft_id: 'C-GABC',
      timestamp: '2026-08-25T18:00:00.000Z',
      position: { latitude: 49.9561, longitude: -119.3777 },
      altitude_ft: 24000,
      groundspeed_kts: 360,
      heading_deg: 90,
      vertical_rate_fpm: 0,
      engine: { temperature_c: 92, rpm: 2200 },
      source: 'simulated',
    },
    ...overrides,
  };
}

describe('PlanView', () => {
  it('renders one glyph per aircraft that has telemetry', () => {
    const { container } = render(
      <PlanView aircraft={[aircraft(), aircraft({ aircraft_id: 'C-GXYZ', callsign: 'CAS102' })]} />,
    );
    expect(container.querySelectorAll('.planview__aircraft')).toHaveLength(2);
  });

  it('skips an aircraft with no telemetry rather than drawing it at the origin', () => {
    const { container } = render(<PlanView aircraft={[aircraft({ latest: null })]} />);
    expect(container.querySelectorAll('.planview__aircraft')).toHaveLength(0);
  });

  it('marks an alerting aircraft distinctly', () => {
    const { container } = render(
      <PlanView aircraft={[aircraft()]} alerting={new Set(['C-GABC'])} />,
    );
    expect(container.querySelector('.planview__aircraft--alert')).toBeInTheDocument();
  });

  it('rotates the glyph to the reported heading, so direction is readable', () => {
    const { container } = render(
      <PlanView aircraft={[aircraft({ latest: { ...aircraft().latest!, heading_deg: 137 } })]} />,
    );
    const glyph = container.querySelector('.planview__aircraft');
    expect(glyph?.getAttribute('transform')).toContain('rotate(137)');
  });

  it('reports the selected aircraft when a glyph is clicked', async () => {
    const onSelect = vi.fn();
    const { container } = render(<PlanView aircraft={[aircraft()]} onSelect={onSelect} />);
    const glyph = container.querySelector('.planview__aircraft');
    expect(glyph).not.toBeNull();
    await userEvent.click(glyph!);
    expect(onSelect).toHaveBeenCalledWith('C-GABC');
  });

  it('draws every reference airport so the scope has fixed points', () => {
    const { container } = render(<PlanView aircraft={[]} />);
    expect(container.querySelectorAll('.planview__airport').length).toBeGreaterThan(8);
  });

  it('places Kelowna inside the drawn area', () => {
    const { container } = render(<PlanView aircraft={[]} />);
    const labels = Array.from(container.querySelectorAll('.planview__airport-label'));
    const ylw = labels.find((l) => l.textContent === 'YLW');
    expect(ylw).toBeDefined();
    const x = Number(ylw?.getAttribute('x') ?? -1);
    const y = Number(ylw?.getAttribute('y') ?? -1);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(100);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(62);
  });

  it('draws a trail only when there is more than one sample', () => {
    const single = render(<PlanView aircraft={[aircraft()]} trail={[aircraft().latest!]} />);
    expect(single.container.querySelector('.planview__trail')).toBeNull();
    single.unmount();

    const multi = render(
      <PlanView
        aircraft={[aircraft()]}
        trail={[
          aircraft().latest!,
          { ...aircraft().latest!, position: { latitude: 50.5, longitude: -120.5 } },
        ]}
      />,
    );
    expect(multi.container.querySelector('.planview__trail')).toBeInTheDocument();
  });

  it('describes itself for screen readers', () => {
    render(<PlanView aircraft={[aircraft()]} />);
    expect(screen.getByRole('img')).toHaveAccessibleName(/1 aircraft/);
  });

  it('uses the shared region definition, not its own copy', () => {
    // Guards against the map and the simulator drifting onto different extents.
    expect(REGION.north).toBeGreaterThan(REGION.south);
    expect(REGION.east).toBeGreaterThan(REGION.west);
  });
});
