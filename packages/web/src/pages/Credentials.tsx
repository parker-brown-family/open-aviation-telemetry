import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CREDENTIALS,
  KIND_LABEL,
  KIND_ORDER,
  type Credential,
  type Evidence,
} from '../credentials-data.js';
import { Panel } from '../components/primitives.js';
import { DocViewer } from '../components/DocViewer.js';

/**
 * Credentials and accomplishments.
 *
 * Same disclosure grammar as the research page — a collapsed index, one line per
 * entry, the detail a tap away — because a wall of achievements read at full
 * volume is the fastest way to make a reader stop believing any of it.
 *
 * Every card ends in evidence, and a card with none says so rather than leaving
 * the reader to assume there is some. That is the same rule the research page
 * applies to a value with no citation, and it matters more here: this is the one
 * page in the console making claims about a person.
 */

/** Resolves a bundled asset or route against the published base path. */
function href(evidence: Evidence): string {
  if (!evidence.local) return evidence.href;
  return `${import.meta.env.BASE_URL}${evidence.href.replace(/^\//, '')}`;
}

function Card({
  credential,
  open,
  onToggle,
  onView,
}: {
  credential: Credential;
  open: boolean;
  onToggle: (id: string) => void;
  onView: (doc: { title: string; src: string }) => void;
}): React.JSX.Element {
  const bodyId = `credential-${credential.id}`;
  return (
    <article className={`cr-card${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="cr-card__head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => onToggle(credential.id)}
      >
        <span className="cr-card__chevron" aria-hidden="true">
          <svg width="7" height="9" viewBox="0 0 7 9" fill="none">
            <path d="M0.5 0.5 L6.5 4.5 L0.5 8.5 Z" fill="currentColor" />
          </svg>
        </span>
        <span className="cr-card__title">
          <span className="cr-card__name">{credential.title}</span>
          <span className="cr-card__issuer">{credential.issuer}</span>
          <span className="cr-card__summary">{credential.summary}</span>
        </span>
        <span className="cr-card__when">{credential.when}</span>
      </button>

      {open ? (
        <div className="cr-card__body" id={bodyId}>
          <p>{credential.detail}</p>

          {credential.evidence.length > 0 ? (
            <div className="cr-evidence">
              <span className="cr-evidence__label">Evidence</span>
              <ul>
                {credential.evidence.map((item) =>
                  item.viewer ? (
                    <li key={item.href}>
                      <button
                        type="button"
                        className="cr-evidence__view"
                        onClick={() =>
                          onView({
                            title: `${credential.title} — ${credential.issuer}`,
                            src: href(item),
                          })
                        }
                      >
                        {item.label} ⤢
                      </button>
                    </li>
                  ) : (
                    <li key={item.href}>
                      <a
                        href={href(item)}
                        target={item.local ? undefined : '_blank'}
                        rel={item.local ? undefined : 'noreferrer noopener'}
                      >
                        {item.label} {item.local ? '' : '↗'}
                      </a>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ) : (
            <p className="cr-evidence__none">
              No public artefact for this one — it was work inside a private codebase, and the
              figures are stated rather than linked.
            </p>
          )}
        </div>
      ) : null}
    </article>
  );
}

export function Credentials(): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const [openIds, setOpenIds] = useState<Set<string>>(() => {
    const focused = params.get('item');
    return new Set(focused ? [focused] : []);
  });

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
          if (openIds.has(id)) next.delete('item');
          else next.set('item', id);
          return next;
        },
        { replace: true },
      );
    },
    [openIds, setParams],
  );

  /**
   * The document on screen, and the control that opened it.
   *
   * The trigger is kept so focus can go back to it on close. Without that, a
   * keyboard reader dismissing the viewer lands at the top of the document and
   * has to tab all the way back to where they were.
   */
  const [viewing, setViewing] = useState<{ title: string; src: string } | null>(null);
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);

  const view = useCallback((doc: { title: string; src: string }) => {
    setTrigger(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setViewing(doc);
  }, []);

  const closeViewer = useCallback(() => {
    setViewing(null);
    trigger?.focus();
  }, [trigger]);

  const withEvidence = CREDENTIALS.filter((item) => item.evidence.length > 0).length;

  return (
    <div className="stack">
      <div className="page__head">
        <h1>Credentials</h1>
        <p>
          What has been earned on the way to building this, and what it is worth taking seriously.
          Each card opens onto the detail and ends in evidence — a certificate to open, a merged
          pull request to read, a number with the before and after that produced it.
        </p>
        <p className="rs-meta">
          {CREDENTIALS.length} entries · {withEvidence} carry a link you can check · the rest say so
        </p>
      </div>

      {KIND_ORDER.map((kind) => {
        const group = CREDENTIALS.filter((item) => item.kind === kind);
        if (group.length === 0) return null;
        return (
          <Panel key={kind} title={KIND_LABEL[kind]} bodyClassName="cr-cards">
            {group.map((credential) => (
              <Card
                key={credential.id}
                credential={credential}
                open={openIds.has(credential.id)}
                onToggle={toggle}
                onView={view}
              />
            ))}
          </Panel>
        );
      })}

      {viewing ? <DocViewer title={viewing.title} src={viewing.src} onClose={closeViewer} /> : null}
    </div>
  );
}
