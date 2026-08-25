import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { AircraftState } from '@oat/shared';
import { PlanView } from './PlanView.js';

/**
 * Focus rings on interactive SVG elements.
 *
 * The bug this guards against, in full, because it is subtle and it looked like
 * a rendering glitch rather than a CSS gap:
 *
 * A target glyph carries tabindex so it can be reached from the keyboard. A
 * MOUSE click focuses it as well — but a mouse click does not match
 * :focus-visible, so a `:focus-visible { outline: … }` rule never fires. Chrome
 * then falls back to its UA `outline: auto`, which is contrast-aware: against a
 * dark map it paints WHITE, and five pixels of it around an eleven-pixel glyph
 * renders as a solid white disc sitting on top of the target it is supposed to
 * be indicating. It persists until focus moves elsewhere.
 *
 * So the rule is: anything focusable inside an SVG must explicitly suppress the
 * UA ring on :focus and supply its own indicator on :focus-visible. This test
 * reads the real stylesheet and checks that every focusable element the
 * components actually render is covered — so adding a new one without the rule
 * fails here rather than in a screenshot.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.resolve(here, '../styles.css'), 'utf8');

/**
 * Every class named anywhere in a rule's selector list.
 *
 * Selectors here are genuinely lists — `.pv-aircraft:focus, .pv-hit:focus { … }`
 * — and a regex that only captures the class nearest the brace silently misses
 * the others. That is exactly the bug this file exists to catch, so the parser
 * has to handle it.
 */
function classesInSelector(selector: string): string[] {
  return Array.from(selector.matchAll(/\.([\w-]+)/g), (m) => m[1]!);
}

function rulesMatching(stylesheet: string, pseudo: string): { classes: string[]; body: string }[] {
  const out: { classes: string[]; body: string }[] = [];
  const rule = /([^{}]+)\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = rule.exec(stylesheet)) !== null) {
    const [, selector, body] = match;
    if (!selector || !body) continue;
    // Only selectors that actually carry the pseudo-class we are asking about.
    const relevant = selector
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.includes(pseudo));
    if (relevant.length > 0) out.push({ classes: relevant.flatMap(classesInSelector), body });
  }
  return out;
}

/** Classes that suppress the UA ring: `.thing:focus { … outline: none … }`. */
function classesSuppressingFocusRing(stylesheet: string): Set<string> {
  const found = new Set<string>();
  for (const { classes, body } of rulesMatching(stylesheet, ':focus')) {
    if (/outline\s*:\s*none/.test(body)) classes.forEach((c) => found.add(c));
  }
  return found;
}

/** Classes that provide a keyboard indicator: `.thing:focus-visible { … }`. */
function classesWithFocusVisibleStyle(stylesheet: string): Set<string> {
  const found = new Set<string>();
  for (const { classes, body } of rulesMatching(stylesheet, ':focus-visible')) {
    // An `outline: none` on its own is suppression, not an indicator.
    if (body.replace(/outline\s*:\s*none\s*;?/, '').trim().length > 0) {
      classes.forEach((c) => found.add(c));
    }
  }
  return found;
}

function aircraft(overrides: Partial<AircraftState> = {}): AircraftState {
  return {
    aircraft_id: 'C-GABC',
    callsign: 'OKA101',
    registration: 'C-GABC',
    type_icao: 'DH8D',
    operator: 'Okanagan Air',
    status: 'active',
    flight_phase: 'cruise',
    first_seen: '2026-08-25T17:00:00.000Z',
    last_seen: '2026-08-25T18:00:00.000Z',
    latest: {
      aircraft_id: 'C-GABC',
      timestamp: '2026-08-25T18:00:00.000Z',
      position: { latitude: 49.9561, longitude: -119.3777 },
      altitude_ft: 24000,
      groundspeed_kts: 360,
      heading_deg: 90,
      vertical_rate_fpm: 0,
      engine: { temperature_c: 92, rpm: 2200 },
      source: 'simulated',
    },
    ...overrides,
  };
}

describe('the stylesheet', () => {
  it('suppresses the UA focus ring on the map targets', () => {
    expect(classesSuppressingFocusRing(css)).toContain('pv-hit');
  });

  it('suppresses the UA focus ring on the architecture nodes', () => {
    expect(classesSuppressingFocusRing(css)).toContain('arch__node');
  });

  it('still gives both a visible keyboard indicator', () => {
    // Suppressing the ring without replacing it would make the app
    // unusable by keyboard, which is a worse bug than the white disc.
    const indicated = classesWithFocusVisibleStyle(css);
    expect(indicated).toContain('pv-hit');
    expect(indicated).toContain('arch__node');
  });

  it('parses a selector list rather than only the class nearest the brace', () => {
    // Guards the parser itself: `.a:focus, .b:focus { outline: none }` must
    // register BOTH, or this whole file quietly stops checking anything.
    const suppressed = classesSuppressingFocusRing(
      '.alpha:focus,\n.beta:focus {\n  outline: none;\n}',
    );
    expect(suppressed).toContain('alpha');
    expect(suppressed).toContain('beta');
  });
});

describe('every focusable element the plan view renders', () => {
  it('carries a class whose UA focus ring is suppressed', () => {
    const { container } = render(
      <PlanView aircraft={[aircraft(), aircraft({ aircraft_id: 'C-GXYZ' })]} selectedId="C-GABC" />,
    );

    const focusable = Array.from(container.querySelectorAll('[tabindex]'));
    expect(focusable.length).toBeGreaterThan(0);

    const suppressed = classesSuppressingFocusRing(css);
    for (const element of focusable) {
      const classes = (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
      expect(
        classes.some((c) => suppressed.has(c)),
        `<${element.tagName} class="${classes.join(' ')}"> is focusable but no :focus rule suppresses the UA ring`,
      ).toBe(true);
    }
  });

  it('keeps the reticle itself unfilled, so it never reads as a solid disc', () => {
    // The white blob looked like the reticle had gained a fill. It had not —
    // but asserting it pins the thing that was suspected first.
    const { container } = render(<PlanView aircraft={[aircraft()]} selectedId="C-GABC" />);
    const reticle = container.querySelector('.pv-reticle');
    expect(reticle).toBeInTheDocument();
    expect(/\.pv-reticle\s*\{[^}]*fill:\s*none/.test(css)).toBe(true);
  });
});
