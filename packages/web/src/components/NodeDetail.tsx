import { useEffect, useState } from 'react';
import type { ArchNode } from '../architecture.js';
import { CODE_EXAMPLES, type CodeExample } from '../generated/code-examples.js';

/**
 * The component detail panel, as folio tabs.
 *
 *   Explanation — what it is, why, what was rejected, how it fails, how it scales.
 *   Examples    — the ACTUAL code that implements it, and real captured output.
 *
 * The examples are not written here and are not pasted. They are sliced out of
 * the real repository by scripts/build-code-examples.mjs at build time, with
 * the path and line numbers they came from, and the generator fails if an
 * anchor has moved. A snippet that merely describes the code becomes a claim
 * about the code within a week; this stays the code.
 *
 * The "captured" badge is the same honesty rule the rest of the app follows:
 * an excerpt from a source file and a response from a running stack are
 * different kinds of evidence, so they do not get to look identical.
 */

const GITHUB = 'https://github.com/parker-brown-family/open-aviation-telemetry/blob/main';

export type DetailTab = 'explanation' | 'examples';

function ExampleBlock({ example }: { example: CodeExample }): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  // Clear the confirmation so the button does not read "copied" forever.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const lines = example.code.split('\n');
  const range =
    example.startLine === example.endLine
      ? `${example.startLine}`
      : `${example.startLine}–${example.endLine}`;

  return (
    <figure className="ex">
      <figcaption className="ex__head">
        <div>
          <div className="ex__title">
            {example.title}
            {example.captured ? <span className="ex__badge">captured output</span> : null}
          </div>
          <a
            className="ex__path"
            href={`${GITHUB}/${example.file}#L${example.startLine}-L${example.endLine}`}
            target="_blank"
            rel="noreferrer noopener"
            title="Open on GitHub"
          >
            {example.file}:{range}
          </a>
        </div>
        <button
          type="button"
          className="small"
          onClick={() => {
            void navigator.clipboard?.writeText(example.code).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </figcaption>
      <pre className={`ex__code lang-${example.lang}`}>
        <code>
          {lines.map((line, i) => (
            <span className="ex__line" key={i}>
              <span className="ex__ln">{example.startLine + i}</span>
              {line || ' '}
            </span>
          ))}
        </code>
      </pre>
    </figure>
  );
}

export function NodeDetail({ node }: { node: ArchNode }): React.JSX.Element {
  const [tab, setTab] = useState<DetailTab>('explanation');
  const examples = CODE_EXAMPLES[node.id] ?? [];

  // Selecting a different component should start on the explanation again —
  // carrying the Examples tab across resets the reader into the middle of
  // something they have not been introduced to yet.
  useEffect(() => setTab('explanation'), [node.id]);

  return (
    <div className="folio">
      <div className="folio__tabs" role="tablist" aria-label="Component detail">
        <button
          type="button"
          role="tab"
          id="tab-explanation"
          aria-selected={tab === 'explanation'}
          aria-controls="panel-explanation"
          className={tab === 'explanation' ? 'is-active' : ''}
          onClick={() => setTab('explanation')}
        >
          Explanation
        </button>
        <button
          type="button"
          role="tab"
          id="tab-examples"
          aria-selected={tab === 'examples'}
          aria-controls="panel-examples"
          className={tab === 'examples' ? 'is-active' : ''}
          onClick={() => setTab('examples')}
          disabled={examples.length === 0}
        >
          Examples
          {examples.length > 0 ? <span className="folio__count">{examples.length}</span> : null}
        </button>
      </div>

      {tab === 'explanation' ? (
        <div
          className="folio__panel detail"
          role="tabpanel"
          id="panel-explanation"
          aria-labelledby="tab-explanation"
        >
          <dl>
            <dt>What it is</dt>
            <dd>{node.what}</dd>
            <dt>Why it is here</dt>
            <dd>{node.why}</dd>
            <dt>What was considered instead</dt>
            <dd>{node.alternative}</dd>
            <dt>How it fails</dt>
            <dd>{node.failure}</dd>
            <dt>How it scales</dt>
            <dd>{node.scaling}</dd>
            <dt>Security</dt>
            <dd>{node.security}</dd>
            <dt>Running locally</dt>
            <dd>{node.localEquivalent}</dd>
            <dt>In the repository</dt>
            <dd>
              {node.source.map((file) => (
                <div key={file}>
                  <a
                    className="mono faint"
                    href={`${GITHUB}/${file}`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {file}
                  </a>
                </div>
              ))}
            </dd>
          </dl>
        </div>
      ) : (
        <div
          className="folio__panel"
          role="tabpanel"
          id="panel-examples"
          aria-labelledby="tab-examples"
        >
          <p className="folio__note">
            Extracted from this repository at build time — path and line numbers are where the code
            actually lives. Entries marked <em>captured output</em> are real responses from a
            running stack.
          </p>
          {examples.map((example) => (
            <ExampleBlock key={`${example.file}:${example.startLine}`} example={example} />
          ))}
        </div>
      )}
    </div>
  );
}
