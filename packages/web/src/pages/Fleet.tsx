import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePoll } from '../api.js';
import { useDataSource } from '../data-source.js';
import { PlanView } from '../components/PlanView.js';
import { Empty, ErrorNote, Panel, Pill, num, since } from '../components/primitives.js';

export function Fleet(): React.JSX.Element {
  const { client, mode } = useDataSource();
  // Selection lives in the URL so a particular aircraft can be linked to and
  // survives a reload — and so the page needs no dynamic route segment.
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('aircraft');
  const [reportMessage, setReportMessage] = useState<string | null>(null);

  const fetchAircraft = useCallback(() => client.aircraft(), [client]);
  const fetchAlerts = useCallback(() => client.alerts(100), [client]);
  const fetchHistory = useCallback(
    () =>
      selectedId ? client.history(selectedId, 60) : Promise.resolve({ count: 0, telemetry: [] }),
    [client, selectedId],
  );

  const fleet = usePoll(fetchAircraft, 2000);
  const alerts = usePoll(fetchAlerts, 5000);
  const history = usePoll(fetchHistory, 3000);

  const alerting = new Set(
    (alerts.data?.alerts ?? [])
      .filter((a) => !a.acknowledged_at && a.severity !== 'info')
      .map((a) => a.aircraft_id),
  );

  const select = (aircraftId: string): void => {
    setReportMessage(null);
    setParams(aircraftId === selectedId ? {} : { aircraft: aircraftId });
  };

  const selected = fleet.data?.aircraft.find((a) => a.aircraft_id === selectedId) ?? null;

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

      <div className="grid grid--split">
        <Panel title={`Aircraft (${num(fleet.data?.count)})`} bodyClassName="">
          {fleet.data && fleet.data.aircraft.length > 0 ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Callsign</th>
                    <th>Registration</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Phase</th>
                    <th className="num">Alt (ft)</th>
                    <th className="num">GS (kt)</th>
                    <th>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {fleet.data.aircraft.map((ac) => (
                    <tr
                      key={ac.aircraft_id}
                      className={ac.aircraft_id === selectedId ? 'is-selected' : ''}
                      onClick={() => select(ac.aircraft_id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td className="mono">
                        {alerting.has(ac.aircraft_id) ? '● ' : ''}
                        {ac.callsign ?? '—'}
                      </td>
                      <td className="mono">{ac.registration ?? ac.aircraft_id}</td>
                      <td className="faint mono">{ac.type_icao ?? '—'}</td>
                      <td>
                        <Pill status={ac.status} />
                      </td>
                      <td className="muted">{ac.flight_phase}</td>
                      <td className="num">{num(ac.latest?.altitude_ft)}</td>
                      <td className="num">{num(ac.latest?.groundspeed_kts)}</td>
                      <td className="faint">{since(ac.last_seen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No aircraft are reporting yet.</Empty>
          )}
        </Panel>

        <div className="stack">
          <Panel title="Track" bodyClassName="panel__body">
            <PlanView
              aircraft={fleet.data?.aircraft ?? []}
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
                <button
                  type="button"
                  className="primary small"
                  onClick={() => void requestReport()}
                >
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
                <dt>heading</dt>
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
              </dl>

              {reportMessage ? (
                <p className="notice" style={{ marginTop: 12 }}>
                  {reportMessage}
                </p>
              ) : null}
            </Panel>
          ) : (
            <Panel title="Aircraft detail" bodyClassName="panel__body">
              <Empty>Select an aircraft to see its detail.</Empty>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
