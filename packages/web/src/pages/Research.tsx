import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  RESEARCH_BUBBLES,
  RESEARCH_GROUPS,
  RESEARCH_TOTALS,
  type Provenance,
  type ResearchField,
  type ResearchSubject,
} from '../research-data.js';
import { Empty, Panel, StatTile } from '../components/primitives.js';

/**
 * The research page.
 *
 * Twenty-one difficult cases is more than anyone reads top to bottom, so the
 * default state is an index: one line per case, everything collapsed. The prose
 * is there when a case is opened, and not before.
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
  open,
  onToggle,
}: {
  subject: ResearchSubject;
  open: boolean;
  onToggle: (id: string) => void;
}): React.JSX.Element {
  const bodyId = `case-${subject.id}`;
  return (
    <article className={`rs-case rs-case--${subject.severity}${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="rs-case__head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => onToggle(subject.id)}
      >
        <span className="rs-case__chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
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
        <h1>Research — where this model is wrong</h1>
        <p>
          Before the telemetry schema hardened, twenty-one difficult-case families were checked
          against the actual standards rather than against intuition. Each case states what the
          naive model assumes, how the quantity is really encoded on the wire, what breaks, and what
          a real system does instead. Values are labelled by how well they are sourced, because on a
          page like this the provenance of a claim is part of the claim.
        </p>
      </div>

      <div className="grid grid--stats">
        <StatTile label="Subjects" value={RESEARCH_TOTALS.subjects} note="across 8 clusters" />
        <StatTile
          label="Complete"
          value={`${RESEARCH_TOTALS.complete}/${RESEARCH_TOTALS.subjects}`}
          note={`${RESEARCH_TOTALS.rounds} round, every required field filled`}
          tone="olive"
        />
        <StatTile
          label="Values sourced"
          value={`${RESEARCH_TOTALS.citedFields}/${RESEARCH_TOTALS.totalFields}`}
          note="the rest are labelled, not hidden"
        />
        <StatTile
          label="Bubble-ups"
          value={RESEARCH_TOTALS.bubbles}
          note="findings the run raised on its own"
          tone="amber"
        />
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
          placeholder="filter cases…"
          aria-label="Filter cases"
          value={query}
          onChange={(event) => search(event.target.value)}
        />
        <span className="faint">
          {matches} of {RESEARCH_TOTALS.subjects} cases
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

      {groups.length === 0 ? <Empty>No case mentions “{query.trim()}”.</Empty> : null}

      {groups.map((group) => (
        <Panel key={group.name} title={group.name} bodyClassName="rs-cases">
          {group.subjects.map((subject) => (
            <Case
              key={subject.id}
              subject={subject}
              open={openIds.has(subject.id)}
              onToggle={toggle}
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
