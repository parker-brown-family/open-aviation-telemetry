import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  RESEARCH_BUBBLES,
  RESEARCH_GROUPS,
  RESEARCH_TOTALS,
  type Provenance,
  type ResearchField,
  type ResearchSubject,
} from '../research-data.js';
import { Empty, Panel } from '../components/primitives.js';

/**
 * The research page — twenty-one lessons, as a thing to read and learn from
 * rather than a report to file.
 *
 * Twenty-one lessons is more than anyone reads top to bottom, so the default
 * state is an index: one line each, everything collapsed. The prose is there
 * when a lesson is opened, and not before. Opening one is a commitment of a
 * screenful, so each lesson also closes from its own foot — see the note there.
 *
 * The original generated report coloured the prose itself — blue where a value
 * carried a source link, gold where it did not — which meant provenance was
 * encoded in something you cannot read at a glance and cannot see at all if you
 * are colour-blind. Here provenance is a labelled tag next to the value, the
 * legend states the three states in words, and body text stays body colour.
 * Colour on this page means severity, exactly as it does everywhere else in the
 * console.
 */

const SEVERITY_NOTE: Record<string, string> = {
  'schema-breaking': 'The schema cannot represent the truth. Cheapest to fix before data exists.',
  'logic-breaking': 'The schema is fine; code computing over it gets the wrong answer.',
  informational: 'Worth knowing. Nothing here is currently wrong because of it.',
};

const PROVENANCE_NOTE: Record<Provenance, string> = {
  cited: 'Links to the standard, study or vendor document it came from.',
  reasoned: 'Worked out from mechanics that are cited, but not itself a published figure.',
  unverified: 'Asserted without a source, and labelled rather than dressed up as fact.',
};

const PROVENANCE_LABEL: Record<Provenance, string> = {
  cited: 'sourced',
  reasoned: 'reasoned',
  unverified: 'unverified',
};

/** Everything a case says, flattened once so the filter can search all of it. */
function haystack(subject: ResearchSubject): string {
  return [
    subject.label,
    subject.group,
    subject.severity,
    ...subject.fields.flatMap((f) => [f.label, f.text, f.caveat ?? '']),
  ]
    .join(' ')
    .toLowerCase();
}

function Tag({ status }: { status: Provenance }): React.JSX.Element {
  return (
    <span className={`rs-tag rs-tag--${status}`} title={PROVENANCE_NOTE[status]}>
      {PROVENANCE_LABEL[status]}
    </span>
  );
}

function Field({ field }: { field: ResearchField }): React.JSX.Element {
  return (
    <div className="rs-field">
      <dt className="rs-field__key">
        <span>{field.label}</span>
        <Tag status={field.status} />
      </dt>
      <dd className="rs-field__value">
        <p>{field.text}</p>
        {field.caveat ? <p className="rs-field__caveat">{field.caveat}</p> : null}
        {field.source ? (
          <a
            className="rs-field__source"
            href={field.source}
            target="_blank"
            rel="noreferrer noopener"
          >
            source ↗
          </a>
        ) : null}
      </dd>
    </div>
  );
}

function Case({
  subject,
  next,
  open,
  onToggle,
  onAdvance,
}: {
  subject: ResearchSubject;
  /** The lesson after this one in the visible order, or null at the end. */
  next: ResearchSubject | null;
  open: boolean;
  onToggle: (id: string) => void;
  onAdvance: (currentId: string, nextId: string) => void;
}): React.JSX.Element {
  const bodyId = `case-${subject.id}`;
  return (
    <article
      id={`lesson-${subject.id}`}
      className={`rs-case rs-case--${subject.severity}${open ? ' is-open' : ''}`}
    >
      <button
        type="button"
        className="rs-case__head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => onToggle(subject.id)}
      >
        {/* Drawn rather than typed: Share Tech Mono has no ▸ glyph, so the
            character falls back to a different font and renders as a dot. */}
        <span className="rs-case__chevron" aria-hidden="true">
          <svg width="7" height="9" viewBox="0 0 7 9" fill="none">
            <path d="M0.5 0.5 L6.5 4.5 L0.5 8.5 Z" fill="currentColor" />
          </svg>
        </span>
        <span className="rs-case__title">
          <span className="rs-case__name">{subject.label}</span>
          <span className="rs-case__summary">{subject.summary}</span>
        </span>
        <span className={`rs-sev rs-sev--${subject.severity}`}>{subject.severity}</span>
        <span className="rs-case__cited">
          {subject.cited}/{subject.fields.length} sourced
        </span>
      </button>

      {open ? (
        <div className="rs-case__body" id={bodyId}>
          <p className="rs-case__sev-note">{SEVERITY_NOTE[subject.severity] ?? ''}</p>
          <dl className="rs-fields">
            {subject.fields.map((field) => (
              <Field key={field.key} field={field} />
            ))}
          </dl>

          {/*
            The control for the end of the reading rather than the top of it. An
            open lesson is taller than the window, so the header that opened it
            has scrolled away by the time you have finished, and hunting back up
            the page is the wrong thing to ask of someone working down the list.

            It advances rather than merely closing, because reading straight
            through is what this page is for: close this one, open the next,
            leave the next one's heading at the top of the window. The last
            lesson has nowhere to advance to, so there it just closes.

            No aria-expanded here — the header is the disclosure control, and two
            controls both announcing the state would be read out twice.
          */}
          <div className="rs-case__foot">
            {next ? (
              <button
                type="button"
                className="rs-collapse"
                aria-label={`Close this lesson and open the next one: ${next.label}`}
                onClick={() => onAdvance(subject.id, next.id)}
              >
                Expand next
                <span className="rs-collapse__chevron" aria-hidden="true">
                  <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                    <path d="M0.5 0.5 L8.5 0.5 L4.5 6.5 Z" fill="currentColor" />
                  </svg>
                </span>
              </button>
            ) : (
              <button
                type="button"
                className="rs-collapse"
                aria-controls={bodyId}
                aria-label={`Collapse ${subject.label}`}
                onClick={() => onToggle(subject.id)}
              >
                <span className="rs-collapse__chevron" aria-hidden="true">
                  <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                    <path d="M0.5 6.5 L4.5 0.5 L8.5 6.5 Z" fill="currentColor" />
                  </svg>
                </span>
                Collapse
              </button>
            )}
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function Research(): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const focused = params.get('case');
  const [query, setQuery] = useState('');
  // Seeded from the URL so a linked case arrives open. After that it is local:
  // opening a case names it in the URL, which is what makes one shareable.
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(focused ? [focused] : []));

  const toggle = useCallback(
    (id: string) => {
      setOpenIds((previous) => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (openIds.has(id)) next.delete('case');
          else next.set('case', id);
          return next;
        },
        { replace: true },
      );
    },
    [openIds, setParams],
  );

  /**
   * Set when a lesson is advanced to, cleared once it has been scrolled to.
   *
   * The scroll cannot happen in the click handler: the lesson being opened is
   * not in the DOM yet, and the one being closed is about to collapse out from
   * under the scroll position. It has to wait for the commit, which is what this
   * state and the effect below are for.
   */
  const [scrollTo, setScrollTo] = useState<string | null>(null);

  const advance = useCallback(
    (currentId: string, nextId: string) => {
      setOpenIds((previous) => {
        const next = new Set(previous);
        next.delete(currentId);
        next.add(nextId);
        return next;
      });
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set('case', nextId);
          return next;
        },
        { replace: true },
      );
      setScrollTo(nextId);
    },
    [setParams],
  );

  useEffect(() => {
    if (!scrollTo) return;
    const element = document.getElementById(`lesson-${scrollTo}`);
    // Guarded because jsdom does not implement scrollIntoView, and a test that
    // exercises this path should assert the state change, not crash on layout.
    if (element && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    setScrollTo(null);
  }, [scrollTo]);

  const needle = query.trim().toLowerCase();

  const groups = useMemo(() => {
    if (!needle) return RESEARCH_GROUPS;
    return RESEARCH_GROUPS.map((group) => ({
      ...group,
      subjects: group.subjects.filter((subject) => haystack(subject).includes(needle)),
    })).filter((group) => group.subjects.length > 0);
  }, [needle]);

  const matches = groups.reduce((n, group) => n + group.subjects.length, 0);
  const allIds = RESEARCH_GROUPS.flatMap((g) => g.subjects.map((s) => s.id));

  /**
   * What "next" means for each lesson, in reading order.
   *
   * Built from the *visible* list rather than the full one, so under a filter
   * the button advances to the next lesson the reader can actually see instead
   * of opening one that the filter has hidden.
   */
  const nextOf = useMemo(() => {
    const visible = groups.flatMap((group) => group.subjects);
    return new Map(visible.map((subject, index) => [subject.id, visible[index + 1] ?? null]));
  }, [groups]);

  /**
   * A filter matches on the body text as well as the title, so a narrowed list
   * opens itself — otherwise a search for "PT6A" returns a row that does not
   * contain the words you searched for. Expansion is set here rather than
   * derived at render so the disclosure buttons keep working while a filter is
   * active; deriving it made them silently do nothing.
   */
  const search = useCallback((value: string) => {
    setQuery(value);
    const next = value.trim().toLowerCase();
    setOpenIds(
      new Set(
        next
          ? RESEARCH_GROUPS.flatMap((group) => group.subjects)
              .filter((subject) => haystack(subject).includes(next))
              .map((subject) => subject.id)
          : [],
      ),
    );
  }, []);

  return (
    <div className="stack">
      <div className="page__head">
        <h1>Lessons in aircraft telemetry</h1>
        <p>
          If you have never worked in aircraft telemetry, tracking real-time data in three
          dimensions — where machine failure puts people’s lives in danger — is a steep learning
          curve. Here are some problem → solution sets to read through, to get used to the language
          and the concepts the industry uses.
        </p>
        <p className="rs-meta">
          {RESEARCH_TOTALS.subjects} lessons · {RESEARCH_GROUPS.length} clusters ·{' '}
          {RESEARCH_TOTALS.citedFields} of {RESEARCH_TOTALS.totalFields} values carry a source link
        </p>
      </div>

      <Panel title="How to read this">
        <div className="rs-legend">
          <div>
            <div className="kicker">Severity — what it costs</div>
            <ul className="rs-legend__list">
              {(['schema-breaking', 'logic-breaking', 'informational'] as const).map((severity) => (
                <li key={severity}>
                  <span className={`rs-sev rs-sev--${severity}`}>{severity}</span>
                  <span className="muted">{SEVERITY_NOTE[severity]}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="kicker">Provenance — how well it is sourced</div>
            <ul className="rs-legend__list">
              {(['cited', 'reasoned', 'unverified'] as const).map((status) => (
                <li key={status}>
                  <Tag status={status} />
                  <span className="muted">{PROVENANCE_NOTE[status]}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Panel>

      <div className="rs-controls">
        <input
          type="search"
          className="rs-search"
          placeholder="filter lessons…"
          aria-label="Filter lessons"
          value={query}
          onChange={(event) => search(event.target.value)}
        />
        <span className="faint">
          {matches} of {RESEARCH_TOTALS.subjects} lessons
        </span>
        <span className="button-row">
          <button type="button" className="small" onClick={() => setOpenIds(new Set(allIds))}>
            Expand all
          </button>
          <button type="button" className="small" onClick={() => setOpenIds(new Set())}>
            Collapse all
          </button>
        </span>
      </div>

      {groups.length === 0 ? <Empty>No lesson mentions “{query.trim()}”.</Empty> : null}

      {groups.map((group) => (
        <Panel key={group.name} title={group.name} bodyClassName="rs-cases">
          {group.subjects.map((subject) => (
            <Case
              key={subject.id}
              subject={subject}
              next={nextOf.get(subject.id) ?? null}
              open={openIds.has(subject.id)}
              onToggle={toggle}
              onAdvance={advance}
            />
          ))}
        </Panel>
      ))}

      <Panel title={`Bubble-ups (${RESEARCH_BUBBLES.length})`}>
        <p className="muted rs-intro">
          Things the run surfaced that nobody asked it for: four serendipitous findings, two
          gap-notes recording what could not be sourced, and two suggestions about the rubric
          itself.
        </p>
        <ul className="rs-bubbles">
          {RESEARCH_BUBBLES.map((bubble) => (
            <li key={`${bubble.subjectId}-${bubble.note.slice(0, 24)}`}>
              <div className="rs-bubble__head">
                <span className={`rs-kind rs-kind--${bubble.kind}`}>
                  {bubble.kind.replace('-', ' ')}
                </span>
                <strong>{bubble.note}</strong>
              </div>
              <p className="muted">{bubble.why}</p>
              <div className="rs-bubble__foot">
                {bubble.subject ? <span className="faint">{bubble.subject}</span> : null}
                {bubble.source ? (
                  <a href={bubble.source} target="_blank" rel="noreferrer noopener">
                    source ↗
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Provenance of this page">
        <p className="muted rs-intro">
          Generated by{' '}
          <a
            href="https://github.com/parker-brown-family"
            target="_blank"
            rel="noreferrer noopener"
          >
            research-delight
          </a>{' '}
          against a declared definition of done: <code>real_encoding</code> and{' '}
          <code>standard</code> were source-required, because bit widths, ranges and units are
          exactly what a language model confabulates fluently. No citation meant no credit. This
          page is built from the run’s own artefacts — nothing here was written by hand.
        </p>
        <div className="button-row">
          <a
            className="rs-doc"
            href="https://github.com/parker-brown-family/open-aviation-telemetry/blob/main/docs/research/telemetry-difficult-cases.md"
            target="_blank"
            rel="noreferrer noopener"
          >
            Full findings (markdown) ↗
          </a>
          <a
            className="rs-doc"
            href="https://github.com/parker-brown-family/open-aviation-telemetry/blob/main/docs/research/run.json"
            target="_blank"
            rel="noreferrer noopener"
          >
            Scores and provenance (run.json) ↗
          </a>
          <a
            className="rs-doc"
            href="https://github.com/parker-brown-family/open-aviation-telemetry/blob/main/docs/research/telemetry-difficult-cases.csv"
            target="_blank"
            rel="noreferrer noopener"
          >
            Spreadsheet (csv) ↗
          </a>
        </div>
      </Panel>
    </div>
  );
}
