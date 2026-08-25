/**
 * The checkbox on a build step.
 *
 * Empty, it is a plain square — the affordance everyone already reads as "not
 * yet". Ticked, a marker X is drawn across it: two strokes, slightly off square
 * and slightly overshooting the box, because a stroke that lands perfectly on
 * the corners reads as a rendered glyph rather than as something someone did.
 *
 * Drawn rather than typed for the same reason as the disclosure chevron and the
 * departing aircraft: the console's font has no box or cross at the weight this
 * needs, so a character would fall back to whatever the system had and sit at a
 * different weight from everything around it.
 */

export interface StepMarkProps {
  done: boolean;
}

export function StepMark({ done }: StepMarkProps): React.JSX.Element {
  return (
    <span className={`tr-mark${done ? ' is-done' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 20 20" width="16" height="16" fill="none">
        <rect
          className="tr-mark__box"
          x="2.5"
          y="2.5"
          width="15"
          height="15"
          rx="2"
          strokeWidth="1.4"
        />
        {/* Overshooting the box on both strokes, and not quite symmetric. */}
        <path
          className="tr-mark__cross"
          d="M4.6 5.4 L15.8 15.1 M15.4 4.9 L4.9 15.6"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
