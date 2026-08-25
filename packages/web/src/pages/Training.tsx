import { useCallback, useEffect, useState } from 'react';
import {
  AREA_LABEL,
  TRAINING_ITEMS,
  TRAINING_STORAGE_KEY,
  type TrainingArea,
} from '../training-data.js';
import { Panel } from '../components/primitives.js';

/**
 * The training checklist.
 *
 * A list you work down over weeks, so the state has to survive the tab closing —
 * it lives in localStorage rather than in the URL or in memory. Nothing here
 * talks to the API; the page is the same whether the stack is running or not.
 *
 * Tapping a row marks it launched: the title takes a heavy strike and an
 * aircraft climbs out to the right. The strike is olive rather than red because
 * in this console red means something is wrong, and a finished course is the
 * opposite of that.
 */

/** The skills this system asks for. A course has to serve one or admit it doesn't. */
const AREA_ORDER: TrainingArea[] = ['aws', 'eks', 'rds', 'kafka', 'rabbitmq', 'microservices'];

function read(): Set<string> {
  try {
    const raw = window.localStorage.getItem(TRAINING_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((id) => typeof id === 'string'))
      : new Set();
  } catch {
    // Private browsing, a full quota, or a corrupted value. An empty checklist
    // is a fine outcome; a page that will not render is not.
    return new Set();
  }
}

function write(ids: Set<string>): void {
  try {
    window.localStorage.setItem(TRAINING_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Nothing to do and nothing worth interrupting the reader over.
  }
}

/**
 * The aircraft that climbs out when a course is finished.
 *
 * Drawn rather than typed for the same reason as the disclosure chevron: the
 * console's font has no aircraft glyph, so a character would fall back to
 * whatever the system had and render at a different weight from everything
 * around it.
 */
function Departure(): React.JSX.Element {
  return (
    <span className="tr-plane" aria-hidden="true">
      <svg viewBox="0 0 54 32" width="54" height="32" fill="none">
        <path className="tr-plane__runway" d="M2 28 H50" strokeDasharray="5 5" />
        <g className="tr-plane__craft">
          <path
            d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"
            fill="currentColor"
          />
        </g>
      </svg>
    </span>
  );
}

export function Training(): React.JSX.Element {
  const [launched, setLaunched] = useState<Set<string>>(read);

  useEffect(() => {
    write(launched);
  }, [launched]);

  const toggle = useCallback((id: string) => {
    setLaunched((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const done = TRAINING_ITEMS.filter((item) => launched.has(item.id)).length;
  const gaps = TRAINING_ITEMS.filter((item) => item.gap);

  return (
    <div className="stack">
      <div className="page__head">
        <h1>Training</h1>
        <p>
          Building this taught the shape of the stack. These close the rest of the distance —
          between having stood a service up once and being able to run it when it misbehaves at 2am.
          Tap a course to mark it launched; the list keeps its place between visits.
        </p>
        <p className="rs-meta">
          {TRAINING_ITEMS.length} courses · {AREA_ORDER.length} skill areas · {done} launched
        </p>
      </div>

      <Panel
        title={`Course list — ${done}/${TRAINING_ITEMS.length} launched`}
        actions={
          <button
            type="button"
            className="small"
            onClick={() => setLaunched(new Set())}
            disabled={done === 0}
          >
            Reset checklist
          </button>
        }
        bodyClassName="tr-list"
      >
        <p className="tr-hint">Tap a row to check it off — the links still open.</p>

        <ol className="tr-items">
          {TRAINING_ITEMS.map((item, index) => {
            const isLaunched = launched.has(item.id);
            return (
              <li key={item.id} className={`tr-item${isLaunched ? ' is-launched' : ''}`}>
                <button
                  type="button"
                  className="tr-item__toggle"
                  aria-pressed={isLaunched}
                  onClick={() => toggle(item.id)}
                >
                  <span className="tr-item__ord" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="tr-item__body">
                    <span className="tr-item__title">{item.title}</span>
                    <span className="tr-item__meta">
                      <span className={`tr-area tr-area--${item.area}`}>
                        {AREA_LABEL[item.area]}
                      </span>
                      <span className="faint">{item.provider}</span>
                    </span>
                  </span>
                  <Departure />
                </button>

                <div className="tr-item__why">
                  <p>{item.why}</p>
                  <a href={item.url} target="_blank" rel="noreferrer noopener" className="tr-open">
                    Open the course ↗
                  </a>
                </div>
              </li>
            );
          })}
        </ol>
      </Panel>

      <Panel title="What the list does not cover">
        <p className="rs-intro">
          Sorted by the skills the system asks for, every course lands in AWS, EKS, RDS or
          microservices. {gaps.map((item) => AREA_LABEL[item.area]).join(' and ')} have no dedicated
          path on AWS Skill Builder, so the two rows above are searches rather than curricula. Both
          are carried by the build today — MSK moves the telemetry stream, Amazon MQ moves the
          report queue — which is worth naming as a gap rather than letting a finished checklist
          imply coverage it does not have.
        </p>
      </Panel>
    </div>
  );
}
