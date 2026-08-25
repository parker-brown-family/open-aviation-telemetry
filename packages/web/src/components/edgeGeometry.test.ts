import { describe, expect, it } from 'vitest';
import { ARCH_EDGES, NODE_BY_ID } from '../architecture.js';
import { NODE_H, NODE_W } from './diagramText.js';
import { EDGE_GAP, insideBox, pointOnQuad, splitQuad, trimEdge } from './edgeGeometry.js';

/**
 * Edges are anchored centre-to-centre and drawn border-to-border. These check
 * the drawn span, because the failure it prevents — a connector ruled straight
 * through the label it points at — is invisible to a type checker and easy to
 * reintroduce.
 */

const centre = (id: string): { x: number; y: number } => {
  const node = NODE_BY_ID.get(id)!;
  return { x: node.x + NODE_W / 2, y: node.y + NODE_H / 2 };
};

/** The same control point Architecture.tsx derives for an edge. */
const controlFor = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2 - Math.abs(b.y - a.y) * 0.12,
});

describe('splitQuad', () => {
  const a = { x: 0, y: 0 };
  const control = { x: 10, y: 20 };
  const b = { x: 20, y: 0 };

  it('returns the whole curve for the full range', () => {
    const whole = splitQuad(a, control, b, 0, 1);
    expect(whole.a).toEqual(a);
    expect(whole.b).toEqual(b);
    expect(whole.control.x).toBeCloseTo(control.x, 10);
    expect(whole.control.y).toBeCloseTo(control.y, 10);
  });

  it('follows the original path exactly', () => {
    // The point of the blossom split. A sampled polyline would pass a
    // "starts and ends in the right place" test while visibly kinking between.
    const part = splitQuad(a, control, b, 0.25, 0.8);
    for (const local of [0, 0.17, 0.5, 0.83, 1]) {
      const t = 0.25 + local * (0.8 - 0.25);
      const onOriginal = pointOnQuad(a, control, b, t);
      const onSplit = pointOnQuad(part.a, part.control, part.b, local);
      expect(onSplit.x).toBeCloseTo(onOriginal.x, 10);
      expect(onSplit.y).toBeCloseTo(onOriginal.y, 10);
    }
  });

  it('is reversible through two successive splits', () => {
    const once = splitQuad(a, control, b, 0.2, 0.9);
    const twice = splitQuad(once.a, once.control, once.b, 0, 1);
    expect(twice.a.x).toBeCloseTo(once.a.x, 10);
    expect(twice.b.y).toBeCloseTo(once.b.y, 10);
  });
});

describe('insideBox', () => {
  const box = { x: 10, y: 10 };

  it('accepts a point in the middle', () => {
    expect(insideBox({ x: 10 + NODE_W / 2, y: 10 + NODE_H / 2 }, box)).toBe(true);
  });

  it('rejects a point beyond the border', () => {
    expect(insideBox({ x: 10 + NODE_W + 0.1, y: 12 }, box)).toBe(false);
  });

  it('counts the padded margin as inside', () => {
    const justOutside = { x: 10 + NODE_W + EDGE_GAP / 2, y: 12 };
    expect(insideBox(justOutside, box)).toBe(false);
    expect(insideBox(justOutside, box, EDGE_GAP)).toBe(true);
  });
});

describe('every edge in the diagram, once trimmed', () => {
  const trimmed = ARCH_EDGES.map((edge) => {
    const a = centre(edge.from);
    const b = centre(edge.to);
    const control = controlFor(a, b);
    return {
      edge,
      from: NODE_BY_ID.get(edge.from)!,
      to: NODE_BY_ID.get(edge.to)!,
      curve: trimEdge(a, control, b, NODE_BY_ID.get(edge.from)!, NODE_BY_ID.get(edge.to)!),
    };
  });

  it('starts outside the box it leaves', () => {
    for (const { edge, from, curve } of trimmed) {
      expect(
        insideBox(curve.a, from),
        `${edge.from} → ${edge.to} still starts inside ${edge.from}`,
      ).toBe(false);
    }
  });

  it('stops outside the box it points at, so the arrowhead lands on the border', () => {
    for (const { edge, to, curve } of trimmed) {
      expect(insideBox(curve.b, to), `${edge.from} → ${edge.to} still ends inside ${edge.to}`).toBe(
        false,
      );
    }
  });

  it('never crosses the interior of its own endpoints', () => {
    // The actual defect: a line ruled across the text of the box it connects.
    for (const { edge, from, to, curve } of trimmed) {
      for (let i = 0; i <= 60; i += 1) {
        const p = pointOnQuad(curve.a, curve.control, curve.b, i / 60);
        expect(insideBox(p, from), `${edge.from} → ${edge.to} crosses ${edge.from}`).toBe(false);
        expect(insideBox(p, to), `${edge.from} → ${edge.to} crosses ${edge.to}`).toBe(false);
      }
    }
  });

  it('still has a visible length to draw', () => {
    for (const { edge, curve } of trimmed) {
      const span = Math.hypot(curve.b.x - curve.a.x, curve.b.y - curve.a.y);
      expect(span, `${edge.from} → ${edge.to} was trimmed to nothing`).toBeGreaterThan(0.5);
    }
  });

  it('keeps the same direction of travel as the untrimmed edge', () => {
    // Trimming must not flip an edge; the arrowhead would point back at the source.
    for (const { edge, curve } of trimmed) {
      const a = centre(edge.from);
      const b = centre(edge.to);
      const full = { x: b.x - a.x, y: b.y - a.y };
      const cut = { x: curve.b.x - curve.a.x, y: curve.b.y - curve.a.y };
      expect(full.x * cut.x + full.y * cut.y, `${edge.from} → ${edge.to} reversed`).toBeGreaterThan(
        0,
      );
    }
  });
});

describe('trimEdge on degenerate input', () => {
  it('leaves the curve alone when the boxes overlap', () => {
    // Nothing sensible to draw between two boxes on top of each other, and a
    // zero-length path with a marker renders as a blob rather than an arrow.
    const box = { x: 0, y: 0 };
    const a = { x: NODE_W / 2, y: NODE_H / 2 };
    const b = { x: NODE_W / 2 + 0.2, y: NODE_H / 2 };
    const control = { x: a.x, y: a.y };
    const out = trimEdge(a, control, b, box, box);
    expect(out.a).toEqual(a);
    expect(out.b).toEqual(b);
  });
});
