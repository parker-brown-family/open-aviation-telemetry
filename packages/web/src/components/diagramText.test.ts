import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ARCH_NODES, diagramService } from '../architecture.js';
import {
  LABEL_CHARS,
  LABEL_FONT,
  NODE_W,
  SERVICE_CHARS,
  SERVICE_FONT,
  TEXT_W,
  fit,
  fitLabel,
  fitService,
  labelWidth,
  serviceWidth,
} from './diagramText.js';

/**
 * The architecture diagram's text fit.
 *
 * SVG text neither wraps nor clips: a string wider than its box draws straight
 * across whatever is beside it. That is how "Stream processor" ended up running
 * out through the right edge of the viewBox and "Infrastructure as code" across
 * the box next to it — with no error, no warning, and nothing to notice until
 * somebody looked at the page.
 *
 * The font is monospace, so the width is arithmetic and these are real
 * assertions rather than a screenshot review.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.resolve(here, '../styles.css'), 'utf8');

/** Pull a font-size out of the stylesheet, in viewBox units. */
function cssFontSize(selector: string): number {
  const rule = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(css);
  const size = /font-size:\s*([\d.]+)px/.exec(rule?.[1] ?? '');
  return Number(size?.[1]);
}

describe('fit', () => {
  it('leaves a string that already fits alone', () => {
    expect(fit('short', 10)).toBe('short');
  });

  it('returns exactly the budget when the string is exactly the budget', () => {
    expect(fit('abcde', 5)).toBe('abcde');
  });

  it('truncates with an ellipsis, staying within the budget', () => {
    const out = fit('abcdefghij', 5);
    expect(out).toBe('abcd…');
    expect(out.length).toBe(5);
  });

  it('does not produce a negative slice for a tiny budget', () => {
    expect(() => fit('abcdef', 0)).not.toThrow();
    expect(fit('abcdef', 1)).toBe('…');
  });
});

describe('the measured metrics', () => {
  it('match the font sizes the stylesheet actually applies', () => {
    // The fit maths is derived from these numbers. If the CSS moves and the
    // constants do not, every box silently goes back to overflowing.
    expect(cssFontSize('.arch__label')).toBe(LABEL_FONT);
    expect(cssFontSize('.arch__service')).toBe(SERVICE_FONT);
  });

  it('leave padding on both sides of the box', () => {
    expect(TEXT_W).toBeLessThan(NODE_W);
    expect(NODE_W - TEXT_W).toBeGreaterThanOrEqual(2);
  });
});

describe('every node fits its box', () => {
  it('draws its label without truncation', () => {
    // Content is authored to fit. An ellipsis in a diagram box reads as a bug
    // even when deliberate, so if this fails the string wants shortening.
    for (const node of ARCH_NODES) {
      expect(fitLabel(node.label), `${node.id} label is truncated`).toBe(node.label);
    }
  });

  it('draws its service line without truncation', () => {
    for (const node of ARCH_NODES) {
      const text = diagramService(node);
      expect(fitService(text), `${node.id} service line is truncated`).toBe(text);
    }
  });

  it('renders both lines inside the available width', () => {
    for (const node of ARCH_NODES) {
      expect(labelWidth(node.label), `${node.id} label overflows`).toBeLessThanOrEqual(TEXT_W);
      expect(
        serviceWidth(diagramService(node)),
        `${node.id} service line overflows`,
      ).toBeLessThanOrEqual(TEXT_W);
    }
  });

  it('would catch a label that is too long', () => {
    // Proves the guard above is load-bearing rather than vacuously true.
    const tooLong = 'x'.repeat(LABEL_CHARS + 5);
    expect(labelWidth(tooLong)).toBeGreaterThan(TEXT_W);
    expect(fitLabel(tooLong)).not.toBe(tooLong);
  });

  it('would catch a service line that is too long', () => {
    const tooLong = 'x'.repeat(SERVICE_CHARS + 5);
    expect(serviceWidth(tooLong)).toBeGreaterThan(TEXT_W);
    expect(fitService(tooLong)).not.toBe(tooLong);
  });
});

describe('the short service names', () => {
  it('exist for every node, or the full name already fits', () => {
    for (const node of ARCH_NODES) {
      const shown = diagramService(node);
      expect(
        serviceWidth(shown),
        `${node.id} has no short form and does not fit`,
      ).toBeLessThanOrEqual(TEXT_W);
    }
  });

  it('keeps the full name available for the detail panel', () => {
    // The abbreviation is a diagram concern only — the panel has room to say
    // "Amazon RDS for PostgreSQL" and should.
    const rds = ARCH_NODES.find((n) => n.id === 'rds');
    expect(rds?.awsService).toMatch(/PostgreSQL/);
    expect(diagramService(rds!)).not.toMatch(/PostgreSQL/);
  });
});
