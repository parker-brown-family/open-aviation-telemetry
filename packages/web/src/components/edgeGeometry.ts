import { NODE_H, NODE_W } from './diagramText.js';

/**
 * Trimming architecture edges back to the borders of the boxes they join.
 *
 * Edges are defined centre-to-centre, because that is the only anchor that
 * stays correct as boxes move. Drawing them centre-to-centre is a different
 * matter: the first and last few units of every curve are inside a box, so
 * each connector is drawn straight through the label it is pointing at — the
 * database edges ran right across "PostgreSQL / Amazon RDS".
 *
 * So the geometry stays centre-to-centre and only the drawn span is trimmed:
 * find where the curve leaves the source box and where it enters the target
 * box, and render just the piece between them. The arrowhead then lands on the
 * border of the target instead of somewhere inside it.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
}

/**
 * Clearance between a box border and the end of a connector, in diagram units.
 *
 * Preferred, not guaranteed. Web client and Ingress sit about one unit apart,
 * so 0.9 of clearance at each end asks for more room than exists between them;
 * `trimEdge` walks down this ladder until a span survives. Ending flush with
 * the border is still far better than driving through the box.
 */
export const EDGE_GAP = 0.9;
const GAP_LADDER = [EDGE_GAP, 0.45, 0.2, 0];

/** How finely the curve is sampled when looking for a border crossing. */
const SAMPLES = 240;

/** Quadratic Bézier at t. */
export function pointOnQuad(a: Point, control: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * control.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * control.y + t * t * b.y,
  };
}

/** True when a point is inside a node box grown by `pad` on every side. */
export function insideBox(p: Point, box: Box, pad = 0): boolean {
  return (
    p.x >= box.x - pad &&
    p.x <= box.x + NODE_W + pad &&
    p.y >= box.y - pad &&
    p.y <= box.y + NODE_H + pad
  );
}

/**
 * The sub-curve of a quadratic Bézier over [t0, t1], as its own quadratic.
 *
 * Exact rather than approximate: the control point is the blossom value
 * f(t0, t1), so the trimmed edge follows precisely the same path as the
 * untrimmed one. Sampling the curve into a polyline would have been easier and
 * would have introduced a visible kink on the tighter curves.
 */
export function splitQuad(
  a: Point,
  control: Point,
  b: Point,
  t0: number,
  t1: number,
): { a: Point; control: Point; b: Point } {
  const blossom = (u: number, v: number): Point => ({
    x: a.x * (1 - u) * (1 - v) + control.x * ((1 - u) * v + u * (1 - v)) + b.x * u * v,
    y: a.y * (1 - u) * (1 - v) + control.y * ((1 - u) * v + u * (1 - v)) + b.y * u * v,
  });
  return { a: blossom(t0, t0), control: blossom(t0, t1), b: blossom(t1, t1) };
}

/**
 * Trim a connector so it runs border-to-border rather than centre-to-centre.
 *
 * Returns the original curve unchanged if trimming would leave nothing to draw
 * — two boxes close enough to overlap have no sensible gap between them, and a
 * zero-length path with an arrowhead renders as a stray blob.
 */
export function trimEdge(
  a: Point,
  control: Point,
  b: Point,
  from: Box,
  to: Box,
): { a: Point; control: Point; b: Point } {
  for (const gap of GAP_LADDER) {
    let t0 = 0;
    for (let i = 0; i <= SAMPLES; i += 1) {
      const t = i / SAMPLES;
      if (!insideBox(pointOnQuad(a, control, b, t), from, gap)) {
        t0 = t;
        break;
      }
    }

    let t1 = 1;
    for (let i = SAMPLES; i >= 0; i -= 1) {
      const t = i / SAMPLES;
      if (!insideBox(pointOnQuad(a, control, b, t), to, gap)) {
        t1 = t;
        break;
      }
    }

    if (t1 > t0) return splitQuad(a, control, b, t0, t1);
  }

  // Boxes overlap: there is no span between them to draw, and a zero-length
  // path carrying an arrowhead renders as a blob rather than an arrow.
  return { a, control, b };
}
