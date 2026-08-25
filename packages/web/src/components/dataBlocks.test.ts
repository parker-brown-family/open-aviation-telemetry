import { describe, expect, it } from 'vitest';
import { overlaps, placeDataBlocks, tiePoint, type Rect } from './dataBlocks.js';

const OPTIONS = { blockWidth: 10, blockHeight: 4, width: 100, height: 62 };

const rect = (x: number, y: number, w = 10, h = 4): Rect => ({ x, y, w, h });

describe('overlaps', () => {
  it('detects two boxes sitting on top of each other', () => {
    expect(overlaps(rect(0, 0), rect(1, 1))).toBe(true);
  });

  it('does not report an overlap for clearly separated boxes', () => {
    expect(overlaps(rect(0, 0), rect(50, 50))).toBe(false);
  });

  it('treats boxes separated by less than the padding as overlapping', () => {
    // Adjacent blocks that technically miss still read as one smear, so the
    // padding is part of the collision test rather than a styling detail.
    expect(overlaps(rect(0, 0), rect(10.1, 0), 0.5)).toBe(true);
    expect(overlaps(rect(0, 0), rect(10.1, 0), 0)).toBe(false);
  });
});

describe('placeDataBlocks', () => {
  it('places a single block at its preferred offset', () => {
    const [placed] = placeDataBlocks([{ id: 'a', x: 50, y: 30 }], OPTIONS);
    expect(placed).toBeDefined();
    expect(placed!.crowded).toBe(false);
    // North-east of the target: right and above.
    expect(placed!.rect.x).toBeGreaterThan(50 - OPTIONS.blockWidth);
    expect(placed!.rect.y).toBeLessThan(30);
  });

  it('gives every block a placement', () => {
    const targets = Array.from({ length: 8 }, (_, i) => ({ id: `a${i}`, x: 20 + i, y: 30 }));
    expect(placeDataBlocks(targets, OPTIONS)).toHaveLength(8);
  });

  it('separates blocks for targets that are stacked on the same point', () => {
    // The case that motivated this: several aircraft clustered near the datum.
    const targets = Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, x: 50, y: 30 }));
    const placed = placeDataBlocks(targets, OPTIONS);

    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        expect(
          overlaps(placed[i]!.rect, placed[j]!.rect),
          `${placed[i]!.id} overlaps ${placed[j]!.id}`,
        ).toBe(false);
      }
    }
  });

  it('marks a block crowded when every candidate position collided', () => {
    // More co-located targets than there are candidate offsets.
    const targets = Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, x: 50, y: 30 }));
    const placed = placeDataBlocks(targets, OPTIONS);
    expect(placed.some((p) => p.crowded)).toBe(true);
  });

  it('gives the first target in the list its preferred position', () => {
    // Callers pass the selected target first, so priority is expressed by order.
    const alone = placeDataBlocks([{ id: 'first', x: 50, y: 30 }], OPTIONS)[0]!;
    const crowded = placeDataBlocks(
      [
        { id: 'first', x: 50, y: 30 },
        { id: 'second', x: 50, y: 30 },
        { id: 'third', x: 50, y: 30 },
      ],
      OPTIONS,
    )[0]!;

    expect(crowded.rect).toEqual(alone.rect);
  });

  it('keeps blocks inside the viewport rather than letting them clip', () => {
    const targets = [
      { id: 'topleft', x: 0, y: 0 },
      { id: 'bottomright', x: 100, y: 62 },
    ];
    for (const p of placeDataBlocks(targets, OPTIONS)) {
      expect(p.rect.x).toBeGreaterThanOrEqual(0);
      expect(p.rect.y).toBeGreaterThanOrEqual(0);
      expect(p.rect.x + p.rect.w).toBeLessThanOrEqual(OPTIONS.width);
      expect(p.rect.y + p.rect.h).toBeLessThanOrEqual(OPTIONS.height);
    }
  });

  it('records the anchor so the tie line knows where the target was', () => {
    const [placed] = placeDataBlocks([{ id: 'a', x: 12, y: 34 }], OPTIONS);
    expect(placed!.anchor).toEqual({ x: 12, y: 34 });
  });

  it('handles an empty target list', () => {
    expect(placeDataBlocks([], OPTIONS)).toEqual([]);
  });
});

describe('tiePoint', () => {
  it('returns the point on the block edge nearest the target', () => {
    const r = rect(20, 20);
    // Target to the left: the tie should meet the left edge, at the target's y.
    expect(tiePoint(r, { x: 5, y: 22 })).toEqual({ x: 20, y: 22 });
    // Target below: the tie should meet the bottom edge, at the target's x.
    expect(tiePoint(r, { x: 25, y: 50 })).toEqual({ x: 25, y: 24 });
  });

  it('clamps to a corner when the target is diagonal to the block', () => {
    const r = rect(20, 20);
    expect(tiePoint(r, { x: 0, y: 0 })).toEqual({ x: 20, y: 20 });
  });

  it('returns the target itself when it is inside the block', () => {
    const r = rect(20, 20);
    expect(tiePoint(r, { x: 25, y: 22 })).toEqual({ x: 25, y: 22 });
  });
});
