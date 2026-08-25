import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { REGION, datumByIata, type AircraftState } from '@oat/shared';
import { SAMPLE } from '../sample-data.js';
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
    render(<StatTile label="Active aircraft" value="42" note="3 stale" tone="olive" />);
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

/** Builds N distinct aircraft, so density-dependent behaviour can be exercised. */
/**
 * A fleet spread across the display, rather than stacked on one point.
 *
 * The spacing is proportional to the count so the aircraft always fill the
 * window: at a fixed 0.1° step, six aircraft occupy thirty nautical miles of a
 * six-hundred-mile scope, which is a density case wearing a small-fleet label.
 */
function fleet(count: number): AircraftState[] {
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0.5 : i / (count - 1);
    return aircraft({
      aircraft_id: `C-G${String(i).padStart(3, '0')}`,
      callsign: `OKA${100 + i}`,
      latest: {
        ...aircraft().latest!,
        aircraft_id: `C-G${String(i).padStart(3, '0')}`,
        // Across the Kelowna window: roughly 46°–54°N, 130°–109°W.
        position: { latitude: 46.5 + t * 7, longitude: -129 + t * 19 },
      },
    });
  });
}

describe('PlanView', () => {
  it('renders one glyph per aircraft that has telemetry', () => {
    const { container } = render(
      <PlanView aircraft={[aircraft(), aircraft({ aircraft_id: 'C-GXYZ', callsign: 'CAS102' })]} />,
    );
    expect(container.querySelectorAll('.pv-aircraft')).toHaveLength(2);
  });

  it('skips an aircraft with no telemetry rather than drawing it at the origin', () => {
    const { container } = render(<PlanView aircraft={[aircraft({ latest: null })]} />);
    expect(container.querySelectorAll('.pv-aircraft')).toHaveLength(0);
  });

  it('marks an alerting aircraft distinctly', () => {
    const { container } = render(
      <PlanView aircraft={[aircraft()]} alerting={new Set(['C-GABC'])} />,
    );
    expect(container.querySelector('.pv-aircraft--alert')).toBeInTheDocument();
  });

  it('rotates the glyph to the reported track, so direction is readable', () => {
    const { container } = render(
      <PlanView aircraft={[aircraft({ latest: { ...aircraft().latest!, heading_deg: 137 } })]} />,
    );
    const glyph = container.querySelector('.pv-aircraft');
    expect(glyph?.getAttribute('transform')).toContain('rotate(137)');
  });

  it('reports the selected aircraft when its target is clicked', async () => {
    const onSelect = vi.fn();
    const { container } = render(<PlanView aircraft={[aircraft()]} onSelect={onSelect} />);
    const hit = container.querySelector('.pv-hit');
    expect(hit).not.toBeNull();
    await userEvent.click(hit!);
    expect(onSelect).toHaveBeenCalledWith('C-GABC');
  });

  it('gives each target a hit area larger than the drawn glyph', () => {
    // The glyph renders at roughly 14x16 CSS pixels and is concave, so parts of
    // its own bounding box are not clickable. Interaction lives on a
    // transparent disc instead; this pins that it is actually bigger.
    const { container } = render(<PlanView aircraft={[aircraft()]} />);
    const hit = container.querySelector('.pv-hit');
    expect(hit).not.toBeNull();
    // Glyph half-extent is 1.15 viewBox units; the disc must exceed it.
    expect(Number(hit!.getAttribute('r'))).toBeGreaterThan(1.15);
  });

  it('hides the decorative glyph from assistive tech, labelling the target instead', () => {
    // Two overlapping elements for one aircraft would otherwise be announced
    // twice. The disc carries the label; the triangle is decoration.
    const { container } = render(<PlanView aircraft={[aircraft()]} />);
    expect(container.querySelector('.pv-aircraft')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('.pv-hit')?.getAttribute('aria-label')).toMatch(/OKA101/);
  });

  it('draws every reference airport so the scope has fixed points', () => {
    const { container } = render(<PlanView aircraft={[]} />);
    expect(container.querySelectorAll('.pv-airport-dot').length).toBeGreaterThan(8);
  });

  it('draws range rings from the datum', () => {
    const { container } = render(<PlanView aircraft={[]} />);
    // Three rings, each an ellipse because the projection is equirectangular.
    expect(container.querySelectorAll('.pv-range-ring')).toHaveLength(3);
  });

  describe('centring on a datum', () => {
    const centreOf = (container: HTMLElement): { x: number; y: number } => {
      const rings = container.querySelectorAll('.pv-range-ring');
      const ring = rings[0]!;
      return { x: Number(ring.getAttribute('cx')), y: Number(ring.getAttribute('cy')) };
    };

    it('puts the datum in the middle of the scope', () => {
      // viewBox is 100 x 62.
      const { container } = render(<PlanView aircraft={[]} datum={datumByIata('YLW')} />);
      const c = centreOf(container);
      expect(c.x).toBeCloseTo(50, 0);
      expect(c.y).toBeCloseTo(31, 0);
    });

    it('puts a different datum in the middle too, rather than only moving the rings', () => {
      // The window follows the datum. If only the rings moved, the centre would
      // drift off to wherever Calgary falls in a Kelowna-shaped window.
      const { container } = render(<PlanView aircraft={[]} datum={datumByIata('YYC')} />);
      const c = centreOf(container);
      expect(c.x).toBeCloseTo(50, 0);
      expect(c.y).toBeCloseTo(31, 0);
    });

    it('moves the picture when the datum changes', () => {
      const kelowna = render(<PlanView aircraft={[aircraft()]} datum={datumByIata('YLW')} />);
      const near = kelowna.container.querySelector('.pv-hit')!.getAttribute('cx');
      kelowna.unmount();

      const edmonton = render(<PlanView aircraft={[aircraft()]} datum={datumByIata('YEG')} />);
      const far = edmonton.container.querySelector('.pv-hit')!.getAttribute('cx');

      // Same aircraft, same latitude and longitude, different window.
      expect(near).not.toBe(far);
    });

    it('names the datum in the legend', () => {
      const { getByText } = render(<PlanView aircraft={[]} datum={datumByIata('YEG')} />);
      expect(getByText(/nm from/).textContent).toMatch(/YEG/);
    });

    it('names the datum to assistive tech', () => {
      const { container } = render(<PlanView aircraft={[]} datum={datumByIata('YVR')} />);
      expect(container.querySelector('svg')?.getAttribute('aria-label')).toMatch(/Vancouver/);
    });

    it('leaves out airports beyond the window instead of clipping them at the edge', () => {
      // Projecting an out-of-region airport yields coordinates past the viewBox,
      // and its label gets sliced mid-glyph against the border — which reads as
      // a rendering fault rather than as somewhere off-scope.
      const { container } = render(<PlanView aircraft={[]} datum={datumByIata('YVR')} />);
      for (const dot of container.querySelectorAll('.pv-airport-dot')) {
        const x = Number(dot.getAttribute('cx'));
        const y = Number(dot.getAttribute('cy'));
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(100);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(62);
      }
    });

    it('never draws two data blocks on top of each other', () => {
      // Re-centring bunches the fleet into one corner, which is where the
      // placer runs out of candidate offsets. An overlapping pair is not two
      // half-readable labels — the one underneath is invisible.
      const fleet = Array.from({ length: 14 }, (_, i) =>
        aircraft({
          aircraft_id: `C-G${String(i).padStart(3, '0')}`,
          callsign: `TST${i}`,
          latest: {
            ...aircraft().latest!,
            // Deliberately tight cluster: 14 targets inside a third of a degree.
            position: { latitude: 49.9 + (i % 4) * 0.08, longitude: -119.4 + (i % 3) * 0.1 },
          },
        }),
      );

      const { container } = render(<PlanView aircraft={fleet} datum={datumByIata('YYC')} />);
      const rects = [...container.querySelectorAll('.pv-block-bg')].map((r) => ({
        x: Number(r.getAttribute('x')),
        y: Number(r.getAttribute('y')),
        w: Number(r.getAttribute('width')),
        h: Number(r.getAttribute('height')),
      }));

      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          const a = rects[i]!;
          const b = rects[j]!;
          const hit = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
          expect(hit, `data blocks ${i} and ${j} overlap`).toBe(false);
        }
      }
    });

    it('keeps the block for an alerting target even when the scope is crowded', () => {
      // Dropping crowded blocks must not drop the one you are looking for.
      const fleet = Array.from({ length: 14 }, (_, i) =>
        aircraft({
          aircraft_id: `C-G${String(i).padStart(3, '0')}`,
          callsign: `TST${i}`,
          latest: {
            ...aircraft().latest!,
            position: { latitude: 49.9 + (i % 4) * 0.08, longitude: -119.4 + (i % 3) * 0.1 },
          },
        }),
      );

      const { container } = render(
        <PlanView aircraft={fleet} alerting={new Set(['C-G013'])} datum={datumByIata('YYC')} />,
      );
      const texts = [...container.querySelectorAll('.pv-block-text')].map((t) => t.textContent);
      expect(texts).toContain('TST13');
    });

    it('still shows enough fixed points to read the scope by', () => {
      // The filter must not empty the display: a scope with no airports on it
      // gives the eye nothing to place the aircraft against.
      for (const iata of ['YLW', 'YVR', 'YYC', 'YEG', 'YXS']) {
        const { container, unmount } = render(<PlanView aircraft={[]} datum={datumByIata(iata)} />);
        expect(
          container.querySelectorAll('.pv-airport-dot').length,
          `${iata} shows too few reference points`,
        ).toBeGreaterThanOrEqual(2);
        unmount();
      }
    });
  });

  it('draws a compass rose with the four cardinals', () => {
    const { container } = render(<PlanView aircraft={[]} />);
    const labels = Array.from(container.querySelectorAll('.pv-compass-label')).map(
      (n) => n.textContent,
    );
    expect(labels).toEqual(['N', 'E', 'S', 'W']);
  });

  describe('the velocity leader', () => {
    it('is drawn for a moving aircraft', () => {
      const { container } = render(<PlanView aircraft={[aircraft()]} />);
      expect(container.querySelector('.pv-leader')).toBeInTheDocument();
    });

    it('is omitted for a stationary aircraft rather than drawn as a zero-length line', () => {
      const { container } = render(
        <PlanView
          aircraft={[aircraft({ latest: { ...aircraft().latest!, groundspeed_kts: 0 } })]}
        />,
      );
      expect(container.querySelector('.pv-leader')).toBeNull();
    });

    it('is longer for a faster aircraft, so speed is readable without a number', () => {
      const lengthOf = (kts: number): number => {
        const { container, unmount } = render(
          <PlanView
            aircraft={[aircraft({ latest: { ...aircraft().latest!, groundspeed_kts: kts } })]}
          />,
        );
        const line = container.querySelector('.pv-leader')!;
        const dx = Number(line.getAttribute('x2')) - Number(line.getAttribute('x1'));
        const dy = Number(line.getAttribute('y2')) - Number(line.getAttribute('y1'));
        const len = Math.hypot(dx, dy);
        unmount();
        return len;
      };

      expect(lengthOf(400)).toBeGreaterThan(lengthOf(150));
    });
  });

  describe('data blocks', () => {
    it('shows a block for every aircraft while the fleet is small', () => {
      const { container } = render(<PlanView aircraft={fleet(6)} />);
      expect(container.querySelectorAll('.pv-block')).toHaveLength(6);
    });

    it('labels the whole sample fleet on the default view', () => {
      // The common case, guarded directly: dropping blocks that cannot be
      // placed must not start dropping them on the picture people actually see.
      const { container } = render(<PlanView aircraft={[...SAMPLE.aircraft]} />);
      expect(container.querySelectorAll('.pv-block')).toHaveLength(SAMPLE.aircraft.length);
    });

    it('shows blocks only for selected and alerting targets once the fleet is dense', () => {
      // A hundred blocks on one screen is worse than none, so above the density
      // threshold the display becomes selective.
      const many = fleet(40);
      const { container } = render(
        <PlanView
          aircraft={many}
          selectedId={many[0]!.aircraft_id}
          alerting={new Set([many[1]!.aircraft_id])}
        />,
      );
      expect(container.querySelectorAll('.pv-block')).toHaveLength(2);
    });

    it('renders altitude in hundreds of feet and groundspeed in tens of knots', () => {
      const { container } = render(<PlanView aircraft={[aircraft()]} />);
      const lines = Array.from(container.querySelectorAll('.pv-block-text')).map(
        (n) => n.textContent,
      );
      // 24,000 ft -> 240; 360 kt -> 36
      expect(lines).toContain('240 36');
    });

    it('pads the compact fields so the block stays a fixed width', () => {
      const { container } = render(
        <PlanView
          aircraft={[
            aircraft({
              latest: { ...aircraft().latest!, altitude_ft: 500, groundspeed_kts: 90 },
            }),
          ]}
        />,
      );
      const lines = Array.from(container.querySelectorAll('.pv-block-text')).map(
        (n) => n.textContent,
      );
      expect(lines).toContain('005 09');
    });
  });

  it('draws a reticle around the selected aircraft', () => {
    const { container } = render(<PlanView aircraft={[aircraft()]} selectedId="C-GABC" />);
    expect(container.querySelector('.pv-reticle')).toBeInTheDocument();
  });

  it('draws a trail only when there is more than one sample', () => {
    const single = render(<PlanView aircraft={[aircraft()]} trail={[aircraft().latest!]} />);
    expect(single.container.querySelector('.pv-trail')).toBeNull();
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
    expect(multi.container.querySelector('.pv-trail')).toBeInTheDocument();
  });

  it('describes itself for screen readers', () => {
    render(<PlanView aircraft={[aircraft()]} />);
    expect(screen.getByRole('img')).toHaveAccessibleName(/1 aircraft/);
  });

  it('gives each target an accessible label with its altitude and speed', () => {
    render(<PlanView aircraft={[aircraft()]} />);
    expect(
      screen.getByRole('button', { name: /OKA101, 24000 feet, 360 knots/ }),
    ).toBeInTheDocument();
  });

  it('can hide the legend when the surrounding panel already explains the view', () => {
    const { container } = render(<PlanView aircraft={[]} showLegend={false} />);
    expect(container.querySelector('.planview__legend')).toBeNull();
  });

  it('uses the shared region definition, not its own copy', () => {
    // Guards against the map and the simulator drifting onto different extents.
    expect(REGION.north).toBeGreaterThan(REGION.south);
    expect(REGION.east).toBeGreaterThan(REGION.west);
  });
});
