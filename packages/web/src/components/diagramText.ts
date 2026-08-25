/**
 * Text fitting for the architecture diagram.
 *
 * SVG `<text>` does not wrap and does not clip. A label wider than its box does
 * not get an ellipsis — it simply draws straight across whatever is next to it,
 * which is what made "Stream processor" run out through the right edge of the
 * viewBox and "Infrastructure as code" run across the box beside it.
 *
 * The font is monospace, so width is exactly predictable: advance-per-character
 * is a constant multiple of the font size. The multipliers below were MEASURED
 * from the rendered page with `getComputedTextLength()` rather than assumed —
 * the assumed 0.5em was wrong by a fifth, which is precisely how the overflow
 * got shipped.
 *
 * Everything here is pure arithmetic, so the fit is asserted by tests rather
 * than by looking at a screenshot.
 */

/** Node box, in the diagram's 100 × 74 coordinate space. */
export const NODE_W = 15;
export const NODE_H = 7;

/** Padding either side of the text inside a node box. */
export const NODE_PAD = 1;

/** Width available to text inside a node box. */
export const TEXT_W = NODE_W - NODE_PAD * 2;

/**
 * Advance width per character, as a multiple of font size.
 *
 * Measured on the live page: the label line renders 0.899 units/char at
 * font-size 1.5, and the service line 0.679 units/char at font-size 1.0. The
 * label runs wider per em because it carries letter-spacing.
 */
export const LABEL_ADVANCE_EM = 0.599;
export const SERVICE_ADVANCE_EM = 0.679;

/** Font sizes chosen so the longest authored string fits without truncation. */
export const LABEL_FONT = 1.3;
export const SERVICE_FONT = 1;

/** Rendered width of a string on each line, in diagram units. */
export const labelWidth = (text: string): number => text.length * LABEL_FONT * LABEL_ADVANCE_EM;
export const serviceWidth = (text: string): number =>
  text.length * SERVICE_FONT * SERVICE_ADVANCE_EM;

/** How many characters fit on each line. Floored, so it is never optimistic. */
export const LABEL_CHARS = Math.floor(TEXT_W / (LABEL_FONT * LABEL_ADVANCE_EM));
export const SERVICE_CHARS = Math.floor(TEXT_W / (SERVICE_FONT * SERVICE_ADVANCE_EM));

/**
 * Truncate to fit, with an ellipsis.
 *
 * This is a safety net, not the mechanism. Content is authored to fit — there
 * is a test asserting every node's diagram text does — because an ellipsis in a
 * diagram box reads as a bug even when it is deliberate. If this ever fires,
 * the string wants shortening, not squeezing.
 */
export function fit(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

export const fitLabel = (text: string): string => fit(text, LABEL_CHARS);
export const fitService = (text: string): string => fit(text, SERVICE_CHARS);
