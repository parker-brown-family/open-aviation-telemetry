import { useCallback, useState } from 'react';
import { usePoll } from '../api.js';
import { useDataSource } from '../data-source.js';
import { ARCH_EDGES, ARCH_NODES, NODE_BY_ID, TOUR } from '../architecture.js';
import { Panel, Pill } from '../components/primitives.js';

/**
 * Node box size, in the diagram's own 100 × 74 coordinate space.
 *
 * Wide enough that the longest label ("Stream processor") fits inside the box
 * at the label font size. SVG does not wrap text, so a label that does not fit
 * simply overflows across whatever is next to it.
 */
const NODE_W = 15;
const NODE_H = 7;

/** Roughly how many monospace characters fit on the service line. */
const SERVICE_CHARS = 23;

function ArchDiagram({
  selectedId,
  highlightId,
  onSelect,
}: {
  selectedId: string;
  highlightId: string | null;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const centre = (id: string): { x: number; y: number } => {
    const node = NODE_BY_ID.get(id);
    if (!node) return { x: 0, y: 0 };
    return { x: node.x + NODE_W / 2, y: node.y + NODE_H / 2 };
  };

  return (
    <div className="arch">
      <svg viewBox="0 0 100 74" role="img" aria-label="System architecture diagram">
        <defs>
          <marker id="arrow" markerWidth="4" markerHeight="4" refX="3.2" refY="2" orient="auto">
            <path d="M0,0 L4,2 L0,4 Z" fill="currentColor" />
          </marker>
        </defs>

        <g>
          {ARCH_EDGES.map((edge) => {
            const a = centre(edge.from);
            const b = centre(edge.to);
            // Curve the link so parallel routes between the same columns do not
            // overlap into an unreadable bundle.
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2 - Math.abs(b.y - a.y) * 0.12;
            return (
              <g
                key={`${edge.from}-${edge.to}`}
                className={`arch__edge-group arch__edge--${edge.kind}`}
              >
                <path
                  className={`arch__edge arch__edge--${edge.kind}`}
                  d={`M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`}
                  markerEnd="url(#arrow)"
                  style={{ color: 'currentColor' }}
                />
                <text className="arch__edge-label" x={mx} y={my - 0.6} textAnchor="middle">
                  {edge.label}
                </text>
              </g>
            );
          })}
        </g>

        <g>
          {ARCH_NODES.map((node) => {
            const classes = [
              'arch__node',
              node.id === selectedId ? 'arch__node--selected' : '',
              node.id === highlightId ? 'arch__node--highlight' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <g
                key={node.id}
                className={classes}
                onClick={() => onSelect(node.id)}
                role="button"
                tabIndex={0}
                aria-label={`${node.label} — ${node.awsService}`}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(node.id);
                  }
                }}
              >
                <rect x={node.x} y={node.y} width={NODE_W} height={NODE_H} />
                <text className="arch__label" x={node.x + 1} y={node.y + 3}>
                  {node.label}
                </text>
                <text className="arch__service" x={node.x + 1} y={node.y + 5.2}>
                  {node.awsService.length > SERVICE_CHARS
                    ? `${node.awsService.slice(0, SERVICE_CHARS - 1)}…`
                    : node.awsService}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="legend">
        <span>
          <i style={{ borderColor: 'var(--cyan)' }} /> synchronous request
        </span>
        <span>
          <i style={{ borderColor: 'var(--violet)', borderTopStyle: 'dashed' }} /> asynchronous
          message
        </span>
        <span>
          <i style={{ borderColor: 'var(--text-faint)' }} /> database access
        </span>
      </div>
    </div>
  );
}

export function Architecture(): React.JSX.Element {
  const { client } = useDataSource();
  const [selectedId, setSelectedId] = useState<string>('api');
  const [tourStep, setTourStep] = useState<number | null>(null);

  const fetchInfrastructure = useCallback(() => client.infrastructure(), [client]);
  const infra = usePoll(fetchInfrastructure, 30_000);

  const selected = NODE_BY_ID.get(selectedId) ?? ARCH_NODES[0];
  const step = tourStep === null ? null : TOUR[tourStep];

  const startTour = (): void => {
    setTourStep(0);
    const first = TOUR[0];
    if (first) setSelectedId(first.nodeId);
  };

  const goto = (index: number): void => {
    const bounded = Math.max(0, Math.min(TOUR.length - 1, index));
    setTourStep(bounded);
    const next = TOUR[bounded];
    if (next) setSelectedId(next.nodeId);
  };

  if (!selected) return <p>No architecture content.</p>;

  return (
    <div className="stack">
      <div className="page__head">
        <h1>Architecture explorer</h1>
        <p>
          Every component, why it is here, what was considered instead, how it fails, and how it
          scales. Select any box in the diagram — or take the guided tour, which follows one
          telemetry report from the aircraft to the dashboard.
        </p>
      </div>

      <div className="panel">
        <div className="panel__head">
          <h2>Guided tour</h2>
          <div className="tour">
            {step ? (
              <>
                <span className="tour__count">
                  {(tourStep ?? 0) + 1} / {TOUR.length}
                </span>
                <button
                  type="button"
                  className="small"
                  onClick={() => goto((tourStep ?? 0) - 1)}
                  disabled={tourStep === 0}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="small primary"
                  onClick={() => goto((tourStep ?? 0) + 1)}
                  disabled={tourStep === TOUR.length - 1}
                >
                  Next
                </button>
                <button type="button" className="small" onClick={() => setTourStep(null)}>
                  Exit
                </button>
              </>
            ) : (
              <button type="button" className="small primary" onClick={startTour}>
                Start the tour
              </button>
            )}
          </div>
        </div>
        {step ? (
          <div className="panel__body">
            <h3 style={{ color: 'var(--amber)', fontSize: 14 }}>{step.title}</h3>
            <p className="muted" style={{ margin: '6px 0 0', maxWidth: '90ch' }}>
              {step.body}
            </p>
          </div>
        ) : null}
      </div>

      <ArchDiagram
        selectedId={selectedId}
        highlightId={step?.nodeId ?? null}
        onSelect={(id) => {
          setSelectedId(id);
          setTourStep(null);
        }}
      />

      <div className="grid grid--split">
        <Panel title={`${selected.label} — ${selected.awsService}`} bodyClassName="panel__body">
          <div className="detail">
            <dl>
              <dt>What it is</dt>
              <dd>{selected.what}</dd>
              <dt>Why it is here</dt>
              <dd>{selected.why}</dd>
              <dt>What was considered instead</dt>
              <dd>{selected.alternative}</dd>
              <dt>How it fails</dt>
              <dd>{selected.failure}</dd>
              <dt>How it scales</dt>
              <dd>{selected.scaling}</dd>
              <dt>Security</dt>
              <dd>{selected.security}</dd>
              <dt>Running locally</dt>
              <dd>{selected.localEquivalent}</dd>
              <dt>In the repository</dt>
              <dd>
                {selected.source.map((path) => (
                  <div key={path} className="mono faint">
                    {path}
                  </div>
                ))}
              </dd>
            </dl>
          </div>
        </Panel>

        <Panel
          title="AWS estate"
          actions={
            infra.data ? (
              <Pill status={infra.data.simulated ? 'warning' : 'healthy'}>
                {infra.data.simulated ? 'simulated' : 'measured'}
              </Pill>
            ) : null
          }
          bodyClassName="panel__body"
        >
          {infra.data ? (
            <>
              <p className="notice" style={{ marginTop: 0 }}>
                {infra.data.disclaimer}
              </p>
              <div className="stack" style={{ gap: 10 }}>
                {infra.data.components.map((component) => (
                  <div key={component.id} className="tile">
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <strong>{component.label}</strong>
                      <Pill status={component.status} />
                    </div>
                    <div className="faint mono" style={{ fontSize: 12 }}>
                      {component.aws_service}
                    </div>
                    <dl className="kv" style={{ marginTop: 8 }}>
                      {Object.entries(component.facts).map(([key, value]) => (
                        <div key={key} style={{ display: 'contents' }}>
                          <dt>{key}</dt>
                          <dd>{String(value)}</dd>
                        </div>
                      ))}
                    </dl>
                    {component.note ? (
                      <p className="faint" style={{ fontSize: 12, margin: '8px 0 0' }}>
                        {component.note}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="muted">Loading infrastructure picture…</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
