import { useCallback, useEffect, useState } from 'react';
import { DATUMS, DEFAULT_DATUM, datumByIata, type Airport } from '@oat/shared';

/**
 * Choosing what the fleet displays are centred on.
 *
 * The list comes from the shared reference data rather than from anything
 * fetched: a dozen airports that move approximately never, needed before the
 * first paint. See ADR-0012 for why this is deliberately not an API call, and
 * what the API-shaped version of the same question looks like.
 *
 * The choice is remembered because it is a preference, not navigation — someone
 * watching Calgary wants Calgary again on the next page and after a reload.
 */

const STORAGE_KEY = 'oat.datum';

/** Read the stored preference. Private browsing makes localStorage throw. */
function storedDatum(): Airport {
  try {
    return datumByIata(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_DATUM;
  }
}

/**
 * The current datum, shared across pages via localStorage.
 *
 * A `storage` listener keeps two open tabs in step, and a custom event does the
 * same for two components in one tab — `storage` does not fire in the tab that
 * wrote the value, so without it the dashboard's picker and its scope would
 * disagree until a reload.
 */
export function useDatum(): [Airport, (iata: string) => void] {
  const [datum, setDatumState] = useState<Airport>(storedDatum);

  useEffect(() => {
    const sync = (): void => setDatumState(storedDatum());
    window.addEventListener('storage', sync);
    window.addEventListener('oat:datum', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('oat:datum', sync);
    };
  }, []);

  const setDatum = useCallback((iata: string): void => {
    const next = datumByIata(iata);
    setDatumState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next.iata);
    } catch {
      // Preference is not persisted; the selection still applies for this view.
    }
    window.dispatchEvent(new Event('oat:datum'));
  }, []);

  return [datum, setDatum];
}

export interface DatumPickerProps {
  datum: Airport;
  onChange: (iata: string) => void;
  /** Shown beside the control, e.g. the tracked count. */
  children?: React.ReactNode;
}

export function DatumPicker({ datum, onChange, children }: DatumPickerProps): React.JSX.Element {
  return (
    <span className="row datum" style={{ gap: 8 }}>
      {children}
      <label className="datum__label" htmlFor="datum-select">
        datum
      </label>
      <select
        id="datum-select"
        className="datum__select"
        value={datum.iata}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Centre the display on an airport"
      >
        {DATUMS.map((airport) => (
          <option key={airport.iata} value={airport.iata}>
            {airport.iata} — {airport.name}
          </option>
        ))}
      </select>
    </span>
  );
}
