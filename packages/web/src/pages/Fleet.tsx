import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AircraftState } from '@oat/shared';
import { usePoll } from '../api.js';
import { useDataSource } from '../data-source.js';
import { FleetView } from '../components/FleetView.js';
import { useFleetTable } from '../components/useFleetTable.js';
import { Empty, ErrorNote, Panel, Pill, num, since } from '../components/primitives.js';

export function Fleet(): React.JSX.Element {
  const { client, mode } = useDataSource();
  // Selection lives in the URL so a particular aircraft can be linked to and
  // survives a reload — and so the page needs no dynamic route segment.
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('aircraft');
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const fetchAircraft = useCallback(() => client.aircraft(), [client]);
  const fetchAlerts = useCallback(() => client.alerts(200), [client]);
  const fetchHistory = useCallback(
    () =>
      selectedId ? client.history(selectedId, 60) : Promise.resolve({ count: 0, telemetry: [] }),
    [client, selectedId],
  );

  const fleet = usePoll(fetchAircraft, 2000);
  const alerts = usePoll(fetchAlerts, 5000);
  const history = usePoll(fetchHistory, 3000);

  const table = useFleetTable(fleet.data?.aircraft ?? []);

  const alerting = new Set(
    (alerts.data?.alerts ?? [])
      .filter((a) => !a.acknowledged_at && a.severity !== 'info')
      .map((a) => a.aircraft_id),
  );

  const alertCount = (id: string): number =>
    (alerts.data?.alerts ?? []).filter((a) => a.aircraft_id === id && !a.acknowledged_at).length;

  const select = useCallback(
    (aircraftId: string | null): void => {
      setReportMessage(null);
      setParams(aircraftId ? { aircraft: aircraftId } : {}, { replace: true });
    },
    [setParams],
  );

  /**
   * Keyboard navigation.
   *
   * An operations console is used by someone watching the screen, not hunting
   * for a mouse: j/k step through the fleet, Escape clears the selection, and
   * "/" jumps to the filter. The handler ignores keystrokes while a field has
   * focus so typing a callsign into the filter does not also move the cursor.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;

      if (event.key === '/' && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === 'Escape') {
        if (typing) {
          (target as HTMLInputElement).blur();
          return;
        }
        select(null);
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

      const step =
        event.key === 'j' || event.key === 'ArrowDown'
          ? 1
          : event.key === 'k' || event.key === 'ArrowUp'
            ? -1
            : 0;
      if (step === 0) return;

      event.preventDefault();
      const rows = table.rows;
      if (rows.length === 0) return;
      const current = rows.findIndex((a) => a.aircraft_id === selectedId);
      // No selection yet: j selects the first row, k the last.
      const nextIndex =
        current === -1
          ? step === 1
            ? 0
            : rows.length - 1
          : Math.min(rows.length - 1, Math.max(0, current + step));
      const next = rows[nextIndex];
      if (next) select(next.aircraft_id);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [table.rows, selectedId, select]);

  const selected: AircraftState | null =
    fleet.data?.aircraft.find((a) => a.aircraft_id === selectedId) ?? null;

  const requestReport = async (): Promise<void> => {
    if (!selected) return;
    setReportMessage('Requesting…');
    try {
      const result = await client.requestReport(selected.aircraft_id, 60);
      setReportMessage(
        `Queued report ${result.report_id.slice(0, 8)} — the API returned immediately; a worker generates it.`,
      );
    } catch (err) {
      setReportMessage(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="stack">
      <div className="page__head">
        <h1>Fleet</h1>
        <p>
          Every airframe that has reported, with its most recent telemetry. Select a row to see its
          track, recent readings and alerts, and to request a report through the asynchronous path.
        </p>
      </div>

      {fleet.error && mode === 'live' ? (
        <ErrorNote>Fleet unavailable: {fleet.error}</ErrorNote>
      ) : null}

      {/*
        The scope leads and gets the wide column; the detail panel sits beside
        it and the table runs full width underneath.

        The obvious layout — table left, map squeezed into the sidebar — makes
        the map useless: at a third of the width the data blocks overlap and
        their text renders below a pixel. The map is the primary object on a
        fleet page, so it gets the room.
      */}
      <div className="grid grid--split">
        <Panel
          title="Plan view"
          actions={
            <span className="faint" style={{ fontSize: 10.5, letterSpacing: '0.12em' }}>
              {table.rows.length} tracked · datum YLW
            </span>
          }
          bodyClassName=""
        >
          <FleetView
            aircraft={table.rows}
            alerting={alerting}
            selectedId={selectedId}
            onSelect={select}
            trail={history.data?.telemetry ?? []}
          />
        </Panel>

        {selected ? (
          <Panel
            title={selected.callsign ?? selected.aircraft_id}
            actions={
              <button type="button" className="primary small" onClick={() => void requestReport()}>
                Request report
              </button>
            }
            bodyClassName="panel__body"
          >
            <dl className="kv">
              <dt>operator</dt>
              <dd>{selected.operator ?? '—'}</dd>
              <dt>type</dt>
              <dd>{selected.type_icao ?? '—'}</dd>
              <dt>phase</dt>
              <dd>{selected.flight_phase}</dd>
              <dt>position</dt>
              <dd>
                {selected.latest
                  ? `${selected.latest.position.latitude.toFixed(3)}, ${selected.latest.position.longitude.toFixed(3)}`
                  : '—'}
              </dd>
              <dt>altitude</dt>
              <dd>{num(selected.latest?.altitude_ft)} ft</dd>
              <dt>groundspeed</dt>
              <dd>{num(selected.latest?.groundspeed_kts)} kt</dd>
              <dt>track</dt>
              <dd>{num(selected.latest?.heading_deg)}°</dd>
              <dt>vertical</dt>
              <dd>{num(selected.latest?.vertical_rate_fpm)} fpm</dd>
              <dt>engine</dt>
              <dd>
                {selected.latest?.engine.temperature_c.toFixed(1) ?? '—'}C ·{' '}
                {num(selected.latest?.engine.rpm)} rpm
              </dd>
              <dt>fuel</dt>
              <dd>{num(selected.latest?.fuel_remaining_kg)} kg</dd>
              <dt>samples</dt>
              <dd>{num(history.data?.count)} in history</dd>
              <dt>alerts</dt>
              <dd>{alertCount(selected.aircraft_id)} unacknowledged</dd>
            </dl>

            {reportMessage ? (
              <p className="notice" style={{ marginTop: 12 }}>
                {reportMessage}
              </p>
            ) : null}
          </Panel>
        ) : (
          <Panel title="Aircraft detail" bodyClassName="panel__body">
            <Empty>
              Select an aircraft — click a row, click a target, or press{' '}
              <span className="kbd">j</span>
            </Empty>
          </Panel>
        )}
      </div>

      <div>
        <Panel
          title={`Aircraft — ${table.rows.length}${
            table.rows.length !== (fleet.data?.count ?? 0) ? ` of ${num(fleet.data?.count)}` : ''
          }`}
          actions={
            <div className="row" style={{ gap: 8 }}>
              <input
                ref={searchRef}
                type="search"
                value={table.query}
                onChange={(e) => table.setQuery(e.target.value)}
                placeholder="filter…"
                aria-label="Filter aircraft by callsign, registration, type or operator"
                style={{
                  font: 'inherit',
                  fontSize: 12,
                  padding: '3px 8px',
                  color: 'rgb(var(--fg))',
                  background: 'rgb(var(--bg) / 0.6)',
                  border: '1px solid rgb(var(--olive) / 0.5)',
                  borderRadius: 3,
                  width: 150,
                }}
              />
              <span className="faint" style={{ fontSize: 10.5, letterSpacing: '0.1em' }}>
                <span className="kbd">/</span> filter <span className="kbd">j</span>
                <span className="kbd">k</span> move <span className="kbd">esc</span> clear
              </span>
            </div>
          }
          bodyClassName=""
        >
          {table.rows.length > 0 ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th
                      className={table.headerClass('callsign')}
                      onClick={() => table.toggleSort('callsign')}
                    >
                      Callsign
                    </th>
                    <th
                      className={table.headerClass('registration')}
                      onClick={() => table.toggleSort('registration')}
                    >
                      Reg
                    </th>
                    <th
                      className={table.headerClass('type_icao')}
                      onClick={() => table.toggleSort('type_icao')}
                    >
                      Type
                    </th>
                    <th
                      className={table.headerClass('status')}
                      onClick={() => table.toggleSort('status')}
                    >
                      Status
                    </th>
                    <th
                      className={table.headerClass('flight_phase')}
                      onClick={() => table.toggleSort('flight_phase')}
                    >
                      Phase
                    </th>
                    <th
                      className={`num ${table.headerClass('altitude_ft')}`}
                      onClick={() => table.toggleSort('altitude_ft')}
                    >
                      Alt ft
                    </th>
                    <th
                      className={`num ${table.headerClass('groundspeed_kts')}`}
                      onClick={() => table.toggleSort('groundspeed_kts')}
                    >
                      GS kt
                    </th>
                    <th
                      className={table.headerClass('last_seen')}
                      onClick={() => table.toggleSort('last_seen')}
                    >
                      Last seen
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((ac) => {
                    const alertsHere = alertCount(ac.aircraft_id);
                    return (
                      <tr
                        key={ac.aircraft_id}
                        className={ac.aircraft_id === selectedId ? 'is-selected' : ''}
                        onClick={() =>
                          select(ac.aircraft_id === selectedId ? null : ac.aircraft_id)
                        }
                        style={{ cursor: 'pointer' }}
                      >
                        <td>
                          {alertsHere > 0 ? (
                            <span
                              style={{ color: 'rgb(var(--red))' }}
                              title={`${alertsHere} unacknowledged alert${alertsHere === 1 ? '' : 's'}`}
                            >
                              ●{' '}
                            </span>
                          ) : null}
                          {ac.callsign ?? '—'}
                        </td>
                        <td>{ac.registration ?? ac.aircraft_id}</td>
                        <td className="faint">{ac.type_icao ?? '—'}</td>
                        <td>
                          <Pill status={ac.status} />
                        </td>
                        <td className="muted">{ac.flight_phase}</td>
                        <td className="num">{num(ac.latest?.altitude_ft)}</td>
                        <td className="num">{num(ac.latest?.groundspeed_kts)}</td>
                        <td className="faint">{since(ac.last_seen)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>
              {table.query ? `Nothing matches "${table.query}"` : 'No aircraft are reporting yet.'}
            </Empty>
          )}
        </Panel>
      </div>
    </div>
  );
}
