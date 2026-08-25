import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DATUMS, DEFAULT_DATUM, datumByIata, distanceNm, regionAround } from '@oat/shared';
import { DatumPicker, useDatum } from './DatumPicker.js';

/**
 * Choosing what the displays are centred on.
 *
 * The list is bundled reference data, not a fetch — see ADR-0012. What is worth
 * testing is therefore not "does it load" but the two things that do have rules:
 * an unknown code must not blank the display, and the choice has to survive
 * moving between pages.
 */

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = '';
});

describe('the selectable datums', () => {
  it('offers more than one, or the control is pointless', () => {
    expect(DATUMS.length).toBeGreaterThan(1);
  });

  it('offers only major fields', () => {
    // Centring a 600-nm window on a small strip shows mostly empty terrain.
    for (const airport of DATUMS) {
      expect(airport.major, `${airport.iata} is not a major field`).toBe(true);
    }
  });

  it('opens on Kelowna, where the fleet is based', () => {
    expect(DEFAULT_DATUM.iata).toBe('YLW');
    expect(DATUMS.some((a) => a.iata === DEFAULT_DATUM.iata)).toBe(true);
  });

  it('falls back to the default for a code it does not know', () => {
    // A stale localStorage value or a hand-edited URL must not blank the scope.
    expect(datumByIata('ZZZZ')).toEqual(DEFAULT_DATUM);
    expect(datumByIata(null)).toEqual(DEFAULT_DATUM);
    expect(datumByIata('')).toEqual(DEFAULT_DATUM);
  });

  it('resolves a code it does know', () => {
    expect(datumByIata('YYC').name).toBe('Calgary');
  });
});

describe('the window built around a datum', () => {
  const ASPECT = 100 / 62;

  it('puts the datum at the centre', () => {
    for (const airport of DATUMS) {
      const region = regionAround(airport, 300, ASPECT);
      expect((region.north + region.south) / 2).toBeCloseTo(airport.latitude, 6);
      expect((region.west + region.east) / 2).toBeCloseTo(airport.longitude, 6);
    }
  });

  it('reaches the requested distance north and south', () => {
    for (const airport of DATUMS) {
      const region = regionAround(airport, 300, ASPECT);
      const toTop = distanceNm(airport, { latitude: region.north, longitude: airport.longitude });
      expect(toTop).toBeCloseTo(300, 0);
    }
  });

  it('keeps distance reading the same on both axes', () => {
    // Equirectangular squashes longitude by cos(latitude). Without the
    // correction a range ring is an ellipse pretending to be a circle.
    for (const airport of DATUMS) {
      const region = regionAround(airport, 300, ASPECT);

      const halfHeightNm = distanceNm(airport, {
        latitude: region.north,
        longitude: airport.longitude,
      });
      const halfWidthNm = distanceNm(airport, {
        latitude: airport.latitude,
        longitude: region.east,
      });

      // Width should exceed height by exactly the viewport aspect ratio.
      expect(halfWidthNm / halfHeightNm).toBeCloseTo(ASPECT, 1);
    }
  });

  it('widens the longitude span as the datum moves north', () => {
    const south = regionAround({ latitude: 45, longitude: -120 }, 300, ASPECT);
    const north = regionAround({ latitude: 60, longitude: -120 }, 300, ASPECT);
    expect(north.east - north.west).toBeGreaterThan(south.east - south.west);
  });

  it('does not diverge at the pole', () => {
    // cos → 0 would send the longitude span to infinity and blank the display.
    const region = regionAround({ latitude: 89.9, longitude: 0 }, 300, ASPECT);
    expect(Number.isFinite(region.east)).toBe(true);
    expect(Number.isFinite(region.west)).toBe(true);
  });
});

describe('the picker', () => {
  it('lists every selectable datum by code and name', () => {
    render(<DatumPicker datum={DEFAULT_DATUM} onChange={() => {}} />);
    for (const airport of DATUMS) {
      expect(
        screen.getByRole('option', { name: `${airport.iata} — ${airport.name}` }),
      ).toBeInTheDocument();
    }
  });

  it('shows the current datum as the selection', () => {
    const calgary = datumByIata('YYC');
    render(<DatumPicker datum={calgary} onChange={() => {}} />);
    expect(screen.getByLabelText('Centre the display on an airport')).toHaveValue('YYC');
  });

  it('reports the code that was chosen', async () => {
    const chosen: string[] = [];
    render(<DatumPicker datum={DEFAULT_DATUM} onChange={(iata) => chosen.push(iata)} />);

    await userEvent.selectOptions(screen.getByLabelText('Centre the display on an airport'), 'YEG');
    expect(chosen).toEqual(['YEG']);
  });

  it('renders whatever the panel passes alongside it', () => {
    render(
      <DatumPicker datum={DEFAULT_DATUM} onChange={() => {}}>
        <span>14 tracked</span>
      </DatumPicker>,
    );
    expect(screen.getByText('14 tracked')).toBeInTheDocument();
  });
});

describe('remembering the choice', () => {
  it('starts at the default with nothing stored', () => {
    const { result } = renderHook(() => useDatum());
    expect(result.current[0]).toEqual(DEFAULT_DATUM);
  });

  it('restores a previous choice', () => {
    window.localStorage.setItem('oat.datum', 'YYC');
    const { result } = renderHook(() => useDatum());
    expect(result.current[0].iata).toBe('YYC');
  });

  it('ignores a stored code that is no longer selectable', () => {
    // Removing an airport from the reference data must not blank the display
    // for whoever last had it selected.
    window.localStorage.setItem('oat.datum', 'NOPE');
    const { result } = renderHook(() => useDatum());
    expect(result.current[0]).toEqual(DEFAULT_DATUM);
  });

  it('persists a new choice', () => {
    const { result } = renderHook(() => useDatum());
    act(() => result.current[1]('YEG'));
    expect(result.current[0].iata).toBe('YEG');
    expect(window.localStorage.getItem('oat.datum')).toBe('YEG');
  });

  it('keeps two components in the same tab in step', () => {
    // `storage` does not fire in the tab that wrote the value, so without the
    // custom event the picker and the scope beside it would disagree.
    const a = renderHook(() => useDatum());
    const b = renderHook(() => useDatum());

    act(() => a.result.current[1]('YXS'));

    expect(a.result.current[0].iata).toBe('YXS');
    expect(b.result.current[0].iata).toBe('YXS');
  });
});
