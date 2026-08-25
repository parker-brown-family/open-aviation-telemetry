import { useCallback, useState } from 'react';
import { usePoll } from '../api.js';
import { useDataSource } from '../data-source.js';
import { ARCH_EDGES, ARCH_NODES, NODE_BY_ID, TOUR, diagramService } from '../architecture.js';
import {
  NODE_H,
  NODE_PAD,
  NODE_W,
  SERVICE_ADVANCE_EM,
  SERVICE_FONT,
  fitLabel,
  fitService,
} from '../components/diagramText.js';
import { trimEdge } from '../components/edgeGeometry.js';
import { NodeDetail } from '../components/NodeDetail.js';
import { Panel, Pill } from '../components/primitives.js';

/** Width of an edge label, in diagram units. Same monospace metric as the boxes. */
const edgeLabelWidth = (text: string): number => text.length * SERVICE_FONT * SERVICE_ADVANCE_EM;

/**
 * Edge-label placement.
 *
 * A label at the midpoint of a curve frequently lands on top of a node box —
 * "project + read" was being cut in half by the Job queue box. The midpoint is
 * only a starting point: if it collides, the label slides along the curve
 * toward whichever end has room.
 *
 * Each label also gets a chip behind it, because these run across connector
 * lines even when they clear the boxes.
 */
function labelPoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
  control: { x: number; y: number },
  width: number,
): { x: number; y: number } {
  // Quadratic Bézier at t.
  const at = (t: number): { x: number; y: number } => ({
    x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * control.x + t ** 2 * b.x,
    y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * control.y + t ** 2 * b.y,
  });

  const clear = (p: { x: number; y: number }): boolean => {
    const box = { x: p.x - width / 2, y: p.y - 1.6, w: width, h: 2.2 };
    return !ARCH_NODES.some(
      (n) =>
        box.x < n.x + NODE_W && box.x + box.w > n.x && box.y < n.y + NODE_H && box.y + box.h > n.y,
    );
  };

  // Midpoint first, then progressively further toward each end.
  for (const t of [0.5, 0.38, 0.62, 0.28, 0.72]) {
    const p = at(t);
    if (clear(p)) return p;
  }

  /*
   * Nothing along the curve is clear. That happens when two boxes are adjacent:
   * Web client and Ingress sit one unit apart, so every point on the connector
   * between them is inside one box or the other, and "HTTP" was drawn
   * underneath the Ingress box.
   *
   * Step the label off the line instead — above first, because that is where
   * the eye goes and there is usually room between rows.
   */
  const mid = at(0.5);
  for (const dy of [-2.6, 3.2, -4.4, 4.8]) {
    const p = { x: mid.x, y: mid.y + dy };
    if (clear(p)) return p;
  }
  return mid;
}

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
            const fromNode = NODE_BY_ID.get(edge.from);
            const toNode = NODE_BY_ID.get(edge.to);
            if (!fromNode || !toNode) return null;
            const a = centre(edge.from);
            const b = centre(edge.to);
            // Curve the link so parallel routes between the same columns do not
            // overlap into an unreadable bundle.
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2 - Math.abs(b.y - a.y) * 0.12;
            const control = { x: mx, y: my };
            const chipW = edgeLabelWidth(edge.label) + 1;
            // Anchored centre-to-centre, drawn border-to-border: otherwise every
            // connector is ruled across the label of the box it points at.
            const cut = trimEdge(a, control, b, fromNode, toNode);
            // Place the label against the trimmed curve rather than the full
            // one. Measured against the full curve, the midpoint of a short
            // edge lands beyond the ink — the "publish telemetry" chip sat over
            // its own arrowhead and the edge looked like it stopped at the label.
            const at = labelPoint(cut.a, cut.b, cut.control, chipW);
            return (
              <g
                key={`${edge.from}-${edge.to}`}
                className={`arch__edge-group arch__edge--${edge.kind}`}
              >
                <path
                  className={`arch__edge arch__edge--${edge.kind}`}
                  d={`M${cut.a.x} ${cut.a.y} Q${cut.control.x} ${cut.control.y} ${cut.b.x} ${cut.b.y}`}
                  markerEnd="url(#arrow)"
                  style={{ color: 'currentColor' }}
                />
                {/* Chip behind the text so it reads over the connector lines. */}
                <rect
                  className="arch__edge-chip"
                  x={at.x - chipW / 2}
                  y={at.y - 1.5}
                  width={chipW}
                  height={2}
                  rx={0.3}
                />
                <text className="arch__edge-label" x={at.x} y={at.y} textAnchor="middle">
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
                <text className="arch__label" x={node.x + NODE_PAD} y={node.y + 3}>
                  {fitLabel(node.label)}
                </text>
                <text className="arch__service" x={node.x + NODE_PAD} y={node.y + 5.1}>
                  {fitService(diagramService(node))}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/*
        Swatch colours are read from the theme tokens the edges actually use.
        These previously referenced --cyan and --violet, which the tactical
        palette does not define — so the swatches rendered with no colour at all
        while the edges beside them were olive and orange.
      */}
      <div className="legend">
        <span>
          <i style={{ borderColor: 'rgb(var(--olive-bright))' }} /> synchronous request
        </span>
        <span>
          <i style={{ borderColor: 'rgb(var(--orange))', borderTopStyle: 'dashed' }} /> asynchronous
          message
        </span>
        <span>
          <i style={{ borderColor: 'rgb(var(--fg-faint))' }} /> database access
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
        <Panel title={`${selected.label} — ${selected.awsService}`} bodyClassName="">
          <NodeDetail node={selected} />
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
