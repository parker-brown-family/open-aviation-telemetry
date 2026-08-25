/**
 * The compass rose. The application's mark, and its favicon.
 *
 * An eight-point rose: four long cardinal points and four short intercardinal
 * ones, each split down its axis into a lit and a shadowed half. That split is
 * what makes it read as a compass rather than as a star — it is the convention
 * every chart rose follows, and without it the shape is just a spiky asterisk.
 *
 * Sized for 20px. The cardinal letters that a printed rose carries are left off
 * deliberately: at this size they land on two or three pixels each and turn to
 * mud, and the mark sits beside the words "Open Aviation Telemetry" anyway.
 *
 * The favicon is generated from the same geometry by
 * scripts/build-favicon.mjs, so the tab icon and the masthead cannot drift
 * apart.
 */

/** Centre and reach, in viewBox units. */
const C = 12;
const CARDINAL = 10.4;
const INTERCARDINAL = 5.9;
const CARDINAL_HALF_WIDTH = 1.85;
const INTERCARDINAL_HALF_WIDTH = 1.35;

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** A point at `reach` from centre along a compass bearing (0 = north, y down). */
function at(bearing: number, reach: number): [number, number] {
  return [C + reach * Math.sin(rad(bearing)), C - reach * Math.cos(rad(bearing))];
}

/**
 * One half of one point of the rose.
 *
 * Each point is two triangles sharing the axis from the centre to the tip. The
 * `side` shoulder sits perpendicular to the axis, so the two halves meet along
 * the axis and can be filled differently.
 */
function half(bearing: number, reach: number, halfWidth: number, side: 1 | -1): string {
  const [tx, ty] = at(bearing, reach);
  const [sx, sy] = at(bearing + side * 90, halfWidth);
  return `M${tx.toFixed(2)} ${ty.toFixed(2)} L${sx.toFixed(2)} ${sy.toFixed(2)} L${C} ${C} Z`;
}

const CARDINALS = [0, 90, 180, 270];
const INTERCARDINALS = [45, 135, 225, 315];

/** Lit halves — the side each point catches light on. */
export const ROSE_LIT: string = [
  ...INTERCARDINALS.map((b) => half(b, INTERCARDINAL, INTERCARDINAL_HALF_WIDTH, 1)),
  ...CARDINALS.map((b) => half(b, CARDINAL, CARDINAL_HALF_WIDTH, 1)),
].join(' ');

/** Shadowed halves, drawn at lower opacity to give the rose its depth. */
export const ROSE_SHADE: string = [
  ...INTERCARDINALS.map((b) => half(b, INTERCARDINAL, INTERCARDINAL_HALF_WIDTH, -1)),
  ...CARDINALS.map((b) => half(b, CARDINAL, CARDINAL_HALF_WIDTH, -1)),
].join(' ');

/** The ring the points sit inside, as on a chart rose. */
export const ROSE_RING_R = 11.1;

export interface CompassRoseProps {
  size?: number;
  /** Set when the rose is the only thing conveying a label. */
  title?: string;
}

export function CompassRose({ size = 20, title }: CompassRoseProps): React.JSX.Element {
  return (
    <svg
      className="rose"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <circle
        className="rose__ring"
        cx={C}
        cy={C}
        r={ROSE_RING_R}
        fill="none"
        stroke="currentColor"
        strokeWidth="0.9"
        opacity="0.42"
      />
      <path className="rose__shade" d={ROSE_SHADE} fill="currentColor" opacity="0.45" />
      <path className="rose__lit" d={ROSE_LIT} fill="currentColor" />
    </svg>
  );
}
