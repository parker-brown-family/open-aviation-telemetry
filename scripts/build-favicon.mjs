#!/usr/bin/env node
/*
 * Generates the favicon from the same geometry the masthead mark uses.
 *
 * WHY THIS IS GENERATED
 * ---------------------
 * A favicon drawn by hand is a second copy of the logo that nobody looks at
 * until it is already wrong. This emits packages/web/public/favicon.svg from
 * the constants in packages/web/src/components/CompassRose.tsx, so changing the
 * mark changes the tab icon.
 *
 *   node scripts/build-favicon.mjs
 *
 * The output is committed, so a plain `pnpm build` needs no extra step. A test
 * re-runs the generator and fails if the committed file has drifted.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(repo, 'packages/web/public/favicon.svg');

// Kept in step with CompassRose.tsx by favicon.test.ts, which reads both.
const C = 12;
const CARDINAL = 10.4;
const INTERCARDINAL = 5.9;
const CARDINAL_HALF_WIDTH = 1.85;
const INTERCARDINAL_HALF_WIDTH = 1.35;
const RING_R = 11.1;

/*
 * Literal colours rather than CSS variables: a tab icon renders outside the
 * page, where the theme's custom properties do not exist.
 *
 * These are --orange and --bg from styles.css, in the same orange the masthead
 * mark uses. favicon.test.ts reads the stylesheet and fails if the tokens move
 * without these following, because nobody looks at a favicon closely enough to
 * notice it drifting.
 */
const MARK = '#ff8c00'; // --orange: 255 140 0
const BACKDROP = '#191812'; // --bg: 25 24 18

const rad = (deg) => (deg * Math.PI) / 180;

function at(bearing, reach) {
  return [C + reach * Math.sin(rad(bearing)), C - reach * Math.cos(rad(bearing))];
}

function half(bearing, reach, halfWidth, side) {
  const [tx, ty] = at(bearing, reach);
  const [sx, sy] = at(bearing + side * 90, halfWidth);
  return `M${tx.toFixed(2)} ${ty.toFixed(2)} L${sx.toFixed(2)} ${sy.toFixed(2)} L${C} ${C} Z`;
}

const CARDINALS = [0, 90, 180, 270];
const INTERCARDINALS = [45, 135, 225, 315];

const lit = [
  ...INTERCARDINALS.map((b) => half(b, INTERCARDINAL, INTERCARDINAL_HALF_WIDTH, 1)),
  ...CARDINALS.map((b) => half(b, CARDINAL, CARDINAL_HALF_WIDTH, 1)),
].join(' ');

const shade = [
  ...INTERCARDINALS.map((b) => half(b, INTERCARDINAL, INTERCARDINAL_HALF_WIDTH, -1)),
  ...CARDINALS.map((b) => half(b, CARDINAL, CARDINAL_HALF_WIDTH, -1)),
].join(' ');

/*
 * A filled backdrop, unlike the masthead mark which sits on the page. A tab
 * icon is composited against whatever chrome the browser is using, and a
 * transparent rose vanishes into a light theme.
 */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32">
  <title>Open Aviation Telemetry</title>
  <rect width="24" height="24" rx="4.5" fill="${BACKDROP}"/>
  <circle cx="${C}" cy="${C}" r="${RING_R - 1.2}" fill="none" stroke="${MARK}" stroke-width="0.9" opacity="0.42"/>
  <path d="${shade}" fill="${MARK}" opacity="0.45"/>
  <path d="${lit}" fill="${MARK}"/>
</svg>
`;

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, svg);
console.log(`build-favicon: wrote ${path.relative(repo, OUT)}`);
