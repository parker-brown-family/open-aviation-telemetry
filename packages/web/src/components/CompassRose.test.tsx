import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { CompassRose, ROSE_LIT, ROSE_SHADE } from './CompassRose.js';

/**
 * The mark, and the favicon generated from it.
 *
 * A favicon is the least-looked-at asset in any project: it is drawn once,
 * diverges from the logo at the first redesign, and nobody notices for a year.
 * So it is generated from this component's geometry, and these tests fail if
 * the committed file stops matching.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
const favicon = readFileSync(path.join(repo, 'packages/web/public/favicon.svg'), 'utf8');
const css = readFileSync(path.join(here, '../styles.css'), 'utf8');

/** Read an `--x: r g b` token out of the stylesheet as a hex string. */
function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`).exec(css);
  if (!match) throw new Error(`--${name} not found in styles.css`);
  return `#${[1, 2, 3].map((i) => Number(match[i]).toString(16).padStart(2, '0')).join('')}`;
}

describe('the rose', () => {
  it('has eight points', () => {
    // Four cardinal, four intercardinal, each split into a lit and a shaded
    // half. Every half is one closed triangle, so eight subpaths per side.
    expect(ROSE_LIT.match(/M/g)).toHaveLength(8);
    expect(ROSE_SHADE.match(/M/g)).toHaveLength(8);
  });

  it('reaches further on the cardinals than the diagonals', () => {
    // What makes it a compass rose rather than an eight-pointed star: north,
    // south, east and west are the long points.
    const tips = [...ROSE_LIT.matchAll(/M([\d.]+) ([\d.]+)/g)].map(([, x, y]) => ({
      x: Number(x),
      y: Number(y),
    }));
    const reach = tips.map((t) => Math.hypot(t.x - 12, t.y - 12));
    const cardinals = reach.filter((r) => r > 8);
    const diagonals = reach.filter((r) => r <= 8);

    expect(cardinals).toHaveLength(4);
    expect(diagonals).toHaveLength(4);
    expect(Math.min(...cardinals)).toBeGreaterThan(Math.max(...diagonals));
  });

  it('points true north, south, east and west', () => {
    const tips = [...ROSE_LIT.matchAll(/M([\d.]+) ([\d.]+)/g)]
      .map(([, x, y]) => ({ x: Number(x), y: Number(y) }))
      .filter((t) => Math.hypot(t.x - 12, t.y - 12) > 8);

    // One tip on each axis, exactly — not rotated off true.
    expect(tips.filter((t) => Math.abs(t.x - 12) < 0.01 && t.y < 12)).toHaveLength(1); // N
    expect(tips.filter((t) => Math.abs(t.x - 12) < 0.01 && t.y > 12)).toHaveLength(1); // S
    expect(tips.filter((t) => Math.abs(t.y - 12) < 0.01 && t.x > 12)).toHaveLength(1); // E
    expect(tips.filter((t) => Math.abs(t.y - 12) < 0.01 && t.x < 12)).toHaveLength(1); // W
  });

  it('stays inside its viewBox', () => {
    for (const [, x, y] of ROSE_LIT.matchAll(/([\d.]+) ([\d.]+)/g)) {
      expect(Number(x)).toBeGreaterThanOrEqual(0);
      expect(Number(x)).toBeLessThanOrEqual(24);
      expect(Number(y)).toBeGreaterThanOrEqual(0);
      expect(Number(y)).toBeLessThanOrEqual(24);
    }
  });

  it('is decoration by default, so it is not announced beside the wordmark', () => {
    const { container } = render(<CompassRose />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg.querySelector('title')).toBeNull();
  });

  it('takes a label when it stands alone', () => {
    const { container } = render(<CompassRose title="Open Aviation Telemetry" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('role', 'img');
    expect(svg.querySelector('title')?.textContent).toBe('Open Aviation Telemetry');
    expect(svg).not.toHaveAttribute('aria-hidden');
  });
});

describe('the favicon', () => {
  it('draws the same geometry as the mark', () => {
    // The drift guard. Regenerate with: node scripts/build-favicon.mjs
    expect(favicon, 'favicon lit path differs — rerun scripts/build-favicon.mjs').toContain(
      ROSE_LIT,
    );
    expect(favicon, 'favicon shade path differs — rerun scripts/build-favicon.mjs').toContain(
      ROSE_SHADE,
    );
  });

  it('uses the same orange the masthead mark renders in', () => {
    // The tab icon cannot read CSS variables, so the value is duplicated as a
    // literal. This is what stops the duplicate going stale.
    expect(favicon.toLowerCase()).toContain(token('orange'));
  });

  it('sits on the console background rather than on transparency', () => {
    // Composited against light browser chrome, a transparent rose disappears.
    expect(favicon.toLowerCase()).toContain(token('bg'));
    expect(favicon).toMatch(/<rect[^>]*width="24"[^>]*height="24"/);
  });

  it('carries a title, since a favicon is often the only label a pinned tab has', () => {
    expect(favicon).toContain('<title>Open Aviation Telemetry</title>');
  });

  it('is declared in the document head', () => {
    const html = readFileSync(path.join(repo, 'packages/web/index.html'), 'utf8');
    expect(html).toMatch(/<link[^>]+rel="icon"[^>]+href="\/favicon\.svg"/);
  });
});
