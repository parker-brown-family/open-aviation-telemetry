/**
 * Placement for the plan view's data blocks.
 *
 * On a real air-traffic display the controller can rotate a target's data block
 * around it to stop it covering another target. This does the same thing
 * automatically: each block tries a ring of candidate offsets and takes the
 * first that does not overlap a block already placed.
 *
 * Kept out of the component because the interesting part is the geometry, and
 * "do two rectangles overlap after placement" is much easier to assert here
 * than through a rendered SVG.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Placement {
  id: string;
  /** Where the block goes. */
  rect: Rect;
  /** The target it belongs to, for drawing the tie line. */
  anchor: { x: number; y: number };
  /** True when every candidate collided and the last one was used anyway. */
  crowded: boolean;
}

/**
 * Candidate offsets, in preference order, as multiples of the block size.
 *
 * North-east first because that is the convention and it keeps the block clear
 * of the velocity leader for the most common (easterly) tracks. The rest walk
 * around the target.
 */
const CANDIDATES: ReadonlyArray<[number, number]> = [
  [0.25, -1.05], // NE
  [-1.25, -1.05], // NW
  [0.25, 0.35], // SE
  [-1.25, 0.35], // SW
  [0.25, -0.35], // E
  [-1.25, -0.35], // W
  [-0.5, -1.6], // N
  [-0.5, 0.75], // S
];

export function overlaps(a: Rect, b: Rect, padding = 0.2): boolean {
  return (
    a.x < b.x + b.w + padding &&
    a.x + a.w + padding > b.x &&
    a.y < b.y + b.h + padding &&
    a.y + a.h + padding > b.y
  );
}

export interface PlaceOptions {
  blockWidth: number;
  blockHeight: number;
  /** Viewport bounds; a block is nudged inside rather than clipped. */
  width: number;
  height: number;
}

/**
 * Places a block for each target, in the order given.
 *
 * Order matters and is the caller's decision: pass the targets that most need a
 * readable block first (selected, then alerting), because the first placements
 * get their preferred position and later ones make way.
 */
export function placeDataBlocks(
  targets: ReadonlyArray<{ id: string; x: number; y: number }>,
  options: PlaceOptions,
): Placement[] {
  const { blockWidth: w, blockHeight: h, width, height } = options;
  const placed: Placement[] = [];

  for (const target of targets) {
    let chosen: Rect | null = null;
    let crowded = true;

    for (const [dx, dy] of CANDIDATES) {
      const rect: Rect = {
        // Clamp inside the viewport so a block near an edge stays legible
        // rather than being half cut off.
        x: Math.min(Math.max(target.x + dx * w, 0.3), width - w - 0.3),
        y: Math.min(Math.max(target.y + dy * h, 0.3), height - h - 0.3),
        w,
        h,
      };
      if (!placed.some((p) => overlaps(rect, p.rect))) {
        chosen = rect;
        crowded = false;
        break;
      }
      // Remember the first candidate as the fallback if every one collides.
      chosen ??= rect;
    }

    if (chosen) {
      placed.push({ id: target.id, rect: chosen, anchor: { x: target.x, y: target.y }, crowded });
    }
  }

  return placed;
}

/**
 * The point on a block's edge nearest the target, so the tie line touches the
 * box rather than running to its corner and through its text.
 */
export function tiePoint(rect: Rect, anchor: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.min(Math.max(anchor.x, rect.x), rect.x + rect.w),
    y: Math.min(Math.max(anchor.y, rect.y), rect.y + rect.h),
  };
}
