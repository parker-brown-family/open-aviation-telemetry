import { useCallback, useState } from 'react';
import { SCENARIOS, isDemoProfileName, type ScenarioName } from '@oat/shared';
import { usePoll } from '../api.js';
import { useDataSource } from '../data-source.js';
import { ErrorNote, Panel, Pill, StatTile, num } from '../components/primitives.js';

export function DemoConsole(): React.JSX.Element {
  const { client, mode } = useDataSource();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const fetchStatus = useCallback(() => client.demoStatus(), [client]);
  const status = usePoll(fetchStatus, 2000);

  const readOnly = mode !== 'live';

  const run = async (label: string, action: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setMessage(null);
    setFailure(null);
    try {
      await action();
      setMessage(`${label} — done.`);
      status.refresh();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const state = status.data?.state;
  const profiles = status.data?.profiles ?? {};
  const scenarios = status.data?.scenarios;

  return (
    <div className="stack">
      <div className="page__head">
        <h1>Demo console</h1>
        <p>
          The simulator posts synthetic telemetry to the real ingest endpoint, so everything it
          produces travels the same path as any other report: HTTP validation, Kafka, the stream
          processor, the database. Fault injection changes what the aircraft reports — it never
          writes an alert directly.
        </p>
      </div>

      {readOnly ? (
        <div className="notice">
          This page is read-only here because no API is attached. The controls below are disabled
          rather than appearing to work. Start the stack locally with <code>make demo</code> to
          drive it.
        </div>
      ) : null}

      {failure ? <ErrorNote>{failure}</ErrorNote> : null}
      {message ? <div className="notice">{message}</div> : null}

      <div className="grid grid--stats">
        <StatTile
          label="Simulation"
          value={state?.running ? 'RUNNING' : 'STOPPED'}
          tone={state?.running ? 'green' : 'default'}
          note={state?.started_at ? `since ${new Date(state.started_at).toLocaleTimeString()}` : ''}
        />
        <StatTile
          label="Profile"
          value={state?.profile ?? '—'}
          note={`${num(state?.fleet_size)} aircraft`}
        />
        <StatTile
          label="Report interval"
          value={state ? `${state.interval_ms}ms` : '—'}
          note="per airframe"
        />
        <StatTile
          label="Active injections"
          value={num(state?.active_injections.length)}
          tone={(state?.active_injections.length ?? 0) > 0 ? 'amber' : 'default'}
          note="fault scenarios"
        />
      </div>

      <Panel title="Simulation control" bodyClassName="panel__body">
        <div className="button-row">
          {Object.entries(profiles).map(([key, profile]) => (
            <button
              key={key}
              type="button"
              className="primary"
              disabled={busy || readOnly || !isDemoProfileName(key)}
              onClick={() =>
                isDemoProfileName(key)
                  ? void run(`Started ${profile.name}`, () => client.demoStart(key))
                  : undefined
              }
              title={profile.description}
            >
              Start {profile.name} ({profile.fleet_size} aircraft)
            </button>
          ))}
          <button
            type="button"
            disabled={busy || readOnly}
            onClick={() => void run('Stopped', () => client.demoStop())}
          >
            Stop
          </button>
          <button
            type="button"
            className="danger"
            disabled={busy || readOnly}
            onClick={() => void run('Reset — all fleet data cleared', () => client.demoReset())}
          >
            Reset and clear data
          </button>
        </div>

        <div className="stack" style={{ gap: 6, marginTop: 14 }}>
          {Object.entries(profiles).map(([key, profile]) => (
            <div key={key} className="faint" style={{ fontSize: 12.5 }}>
              <strong className="mono">{key}</strong> — {profile.description}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Fault injection" bodyClassName="panel__body">
        <p className="muted" style={{ marginTop: 0 }}>
          Each scenario exists to make one architectural behaviour visible rather than described.
        </p>
        <div className="stack" style={{ gap: 10 }}>
          {SCENARIOS.map((name: ScenarioName) => {
            const detail = scenarios?.[name];
            const active = state?.active_injections.some((i) => i.scenario === name) ?? false;
            return (
              <div key={name} className="tile">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <strong>{detail?.name ?? name}</strong>{' '}
                    {active ? <Pill status="warning">active</Pill> : null}
                    <div className="faint" style={{ fontSize: 12.5 }}>
                      Demonstrates: {detail?.demonstrates ?? '—'}
                    </div>
                    <div className="faint" style={{ fontSize: 12.5 }}>
                      Expect: {detail?.expected ?? '—'}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy || readOnly}
                    onClick={() =>
                      void run(`Injected ${detail?.name ?? name}`, () => client.scenario(name))
                    }
                  >
                    Inject
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
