import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ALERT_LABELS, THRESHOLDS, type AlertKind } from '@oat/shared';
import { usePoll } from '../api.js';
import { useDataSource } from '../data-source.js';
import { Empty, ErrorNote, Panel, Pill, num, since } from '../components/primitives.js';

const THRESHOLD_ROWS: { kind: AlertKind; rule: string }[] = [
  {
    kind: 'engine_overtemp',
    rule: `warning at ${THRESHOLDS.engineTempWarningC}C, critical at ${THRESHOLDS.engineTempCriticalC}C`,
  },
  {
    kind: 'engine_rpm_out_of_band',
    rule: `outside ${THRESHOLDS.engineRpmMin}–${THRESHOLDS.engineRpmMax} rpm while above ${THRESHOLDS.airborneAltitudeFt} ft`,
  },
  {
    kind: 'rapid_descent',
    rule: `descent steeper than ${Math.abs(THRESHOLDS.rapidDescentFpm)} fpm`,
  },
  {
    kind: 'low_altitude_high_speed',
    rule: `above ${THRESHOLDS.highSpeedKts} kt below ${THRESHOLDS.lowAltitudeFt} ft`,
  },
  { kind: 'fuel_low', rule: `fuel remaining below ${THRESHOLDS.fuelLowKg} kg` },
  { kind: 'telemetry_gap', rule: `no report for ${THRESHOLDS.telemetryGapMs / 1000}s` },
];

export function Alerts(): React.JSX.Element {
  const { client, mode } = useDataSource();
  const fetchAlerts = useCallback(() => client.alerts(200), [client]);
  const fetchReports = useCallback(() => client.reports(25), [client]);

  const alerts = usePoll(fetchAlerts, 3000);
  const reports = usePoll(fetchReports, 3000);

  return (
    <div className="stack">
      <div className="page__head">
        <h1>Alerts and reports</h1>
        <p>
          Alerts are derived by the stream processor from raw telemetry, not reported by the
          aircraft. An identical alert for the same airframe is suppressed for sixty seconds, so a
          sustained condition raises one alert rather than one per report.
        </p>
      </div>

      {alerts.error && mode === 'live' ? (
        <ErrorNote>Alerts unavailable: {alerts.error}</ErrorNote>
      ) : null}

      <Panel title={`Alerts (${num(alerts.data?.count)})`} bodyClassName="">
        {alerts.data && alerts.data.alerts.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Aircraft</th>
                  <th>Kind</th>
                  <th>Message</th>
                  <th>Raised</th>
                </tr>
              </thead>
              <tbody>
                {alerts.data.alerts.map((alert) => (
                  <tr key={alert.alert_id}>
                    <td>
                      <Pill status={alert.severity} />
                    </td>
                    <td className="mono">
                      <Link to={`/fleet?aircraft=${encodeURIComponent(alert.aircraft_id)}`}>
                        {alert.aircraft_id}
                      </Link>
                    </td>
                    <td className="muted">{ALERT_LABELS[alert.kind] ?? alert.kind}</td>
                    <td className="faint">{alert.message}</td>
                    <td className="faint">{since(alert.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No alerts have been raised.</Empty>
        )}
      </Panel>

      <div className="grid grid--split">
        <Panel title={`Reports (${num(reports.data?.count)})`} bodyClassName="">
          {reports.data && reports.data.reports.length > 0 ? (
            <div className="table-scroll" style={{ maxHeight: 340 }}>
              <table>
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Aircraft</th>
                    <th className="num">Attempts</th>
                    <th className="num">Samples</th>
                    <th className="num">Distance</th>
                    <th>Requested</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.data.reports.map((report) => (
                    <tr key={report.report_id}>
                      <td>
                        <Pill status={report.status} />
                      </td>
                      <td className="mono">{report.aircraft_id}</td>
                      <td className="num">{report.attempts}</td>
                      <td className="num">{report.payload ? num(report.payload.samples) : '—'}</td>
                      <td className="num">
                        {report.payload ? `${num(report.payload.distance_nm, 1)} nm` : '—'}
                      </td>
                      <td className="faint">{since(report.requested_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>
              No reports requested yet. Request one from the <Link to="/fleet">fleet page</Link>.
            </Empty>
          )}
        </Panel>

        <Panel title="Detection rules" bodyClassName="">
          <table>
            <thead>
              <tr>
                <th>Alert</th>
                <th>Rule</th>
              </tr>
            </thead>
            <tbody>
              {THRESHOLD_ROWS.map((row) => (
                <tr key={row.kind}>
                  <td>{ALERT_LABELS[row.kind]}</td>
                  <td className="faint mono">{row.rule}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="faint" style={{ padding: '10px 12px', margin: 0, fontSize: 12 }}>
            These values are imported from the same constants the stream processor evaluates, so
            this table cannot drift away from the implementation.
          </p>
        </Panel>
      </div>
    </div>
  );
}
