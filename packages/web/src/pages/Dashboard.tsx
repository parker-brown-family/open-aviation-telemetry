import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { usePoll } from '../api.js';
import { useDataSource } from '../data-source.js';
import { PlanView } from '../components/PlanView.js';
import {
  Empty,
  ErrorNote,
  Panel,
  Pill,
  Pulse,
  StatTile,
  num,
  since,
} from '../components/primitives.js';

export function Dashboard(): React.JSX.Element {
  const { client, mode } = useDataSource();

  const fetchStats = useCallback(() => client.stats(), [client]);
  const fetchAircraft = useCallback(() => client.aircraft(), [client]);
  const fetchAlerts = useCallback(() => client.alerts(20), [client]);

  const stats = usePoll(fetchStats, 2000);
  const fleet = usePoll(fetchAircraft, 2000);
  const alerts = usePoll(fetchAlerts, 4000);

  const alerting = new Set(
    (alerts.data?.alerts ?? [])
      .filter((a) => !a.acknowledged_at && a.severity !== 'info')
      .map((a) => a.aircraft_id),
  );

  const f = stats.data?.fleet;
  const stream = stats.data?.stream;
  const jobs = stats.data?.jobs;
  const api = stats.data?.api;

  return (
    <div className="stack">
      <div className="page__head">
        <h1>Fleet dashboard</h1>
        {/*
          The description follows the data source. Claiming "every figure is
          measured" while rendering a bundled sample would be exactly the kind of
          quiet untruth the banner above exists to prevent.
        */}
        <p>
          {mode === 'live' ? (
            <>
              Live operational picture. Every figure on this page comes from the platform itself —
              counts from PostgreSQL, consumer lag from Kafka, queue depth from RabbitMQ, request
              counters from the API process.
            </>
          ) : (
            <>
              This is what the operational picture looks like. With a live API attached, every
              figure here is measured — counts from PostgreSQL, consumer lag from Kafka, queue depth
              from RabbitMQ. Right now they come from the bundled sample dataset.
            </>
          )}
        </p>
      </div>

      {stats.error && mode === 'live' ? (
        <ErrorNote>Stats unavailable: {stats.error}</ErrorNote>
      ) : null}

      <div className="grid grid--stats">
        <StatTile
          label="Active aircraft"
          value={num(f?.aircraft_active)}
          note={`${num(f?.aircraft_stale)} stale · ${num(f?.aircraft_lost)} lost`}
          tone="olive"
        />
        <StatTile
          label="Telemetry / min"
          value={num(f?.telemetry_last_minute)}
          note={`${num(f?.telemetry_rows)} rows stored`}
        />
        <StatTile
          label="Consumer lag"
          value={stream?.lag ? num(stream.lag.total_lag) : '—'}
          note={
            stream?.connected
              ? `${stream.lag?.partitions.length ?? 0} partitions · ${stream.consumer_group}`
              : 'stream disconnected'
          }
          tone={(stream?.lag?.total_lag ?? 0) > 500 ? 'amber' : 'default'}
        />
        <StatTile
          label="Queue depth"
          value={jobs?.depth ? num(jobs.depth.pending) : '—'}
          note={
            jobs?.depth ? `${num(jobs.depth.dead_lettered)} dead-lettered` : 'queue disconnected'
          }
          tone={(jobs?.depth?.dead_lettered ?? 0) > 0 ? 'amber' : 'default'}
        />
        <StatTile
          label="Critical alerts"
          value={num(f?.alerts_critical_last_hour)}
          note="last hour"
          tone={(f?.alerts_critical_last_hour ?? 0) > 0 ? 'red' : 'olive'}
        />
        <StatTile
          label="API p95"
          value={api ? `${api.request_latency_ms.p95.toFixed(1)}ms` : '—'}
          note={
            api
              ? `${num(api.counters.http_requests)} requests · ${num(api.counters.http_errors)} errors`
              : ''
          }
        />
      </div>

      <div className="grid grid--split">
        <Panel
          title="Plan view"
          actions={
            <span className="row" style={{ gap: 8 }}>
              <Pulse capturedAt={stats.data?.captured_at} />
              <span className="faint">{num(fleet.data?.count)} tracked</span>
            </span>
          }
          bodyClassName="panel__body"
        >
          {fleet.data && fleet.data.aircraft.length > 0 ? (
            <PlanView aircraft={fleet.data.aircraft} alerting={alerting} />
          ) : (
            <Empty>
              No aircraft are reporting.{' '}
              <Link to="/demo">Start the simulator from the demo console.</Link>
            </Empty>
          )}
        </Panel>

        <div className="stack">
          <Panel
            title="Recent alerts"
            actions={<Link to="/alerts">All alerts</Link>}
            bodyClassName=""
          >
            {alerts.data && alerts.data.alerts.length > 0 ? (
              <div className="table-scroll" style={{ maxHeight: 300 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Aircraft</th>
                      <th>Alert</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alerts.data.alerts.slice(0, 8).map((alert) => (
                      <tr key={alert.alert_id}>
                        <td className="mono">{alert.aircraft_id}</td>
                        <td>
                          <Pill status={alert.severity} />{' '}
                          <span className="muted">{alert.kind.replace(/_/g, ' ')}</span>
                        </td>
                        <td className="faint">{since(alert.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>No alerts. The fleet is nominal.</Empty>
            )}
          </Panel>

          <Panel title="Pipeline" bodyClassName="panel__body">
            <dl className="kv">
              <dt>topic</dt>
              <dd>{stream?.topic ?? '—'}</dd>
              <dt>group</dt>
              <dd>{stream?.consumer_group ?? '—'}</dd>
              <dt>stream</dt>
              <dd>
                <Pill status={stream?.connected ? 'healthy' : 'lost'}>
                  {stream?.connected ? 'connected' : 'disconnected'}
                </Pill>
              </dd>
              <dt>queue</dt>
              <dd>{jobs?.queue ?? '—'}</dd>
              <dt>jobs</dt>
              <dd>
                <Pill status={jobs?.connected ? 'healthy' : 'lost'}>
                  {jobs?.connected ? 'connected' : 'disconnected'}
                </Pill>
              </dd>
              <dt>reports</dt>
              <dd>
                {num(f?.reports_completed)} done · {num(f?.reports_pending)} pending ·{' '}
                {num(f?.reports_failed)} failed
              </dd>
              <dt>uptime</dt>
              <dd>{api ? `${Math.floor(api.uptime_seconds / 60)}m` : '—'}</dd>
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}
