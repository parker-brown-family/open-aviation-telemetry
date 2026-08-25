#!/usr/bin/env node
/*
 * Turns the research-delight run in docs/research into a typed module the web
 * client can import.
 *
 * The run leaves three artefacts behind and no single one of them is enough:
 *
 *   run.json  — per-field provenance status and the bubble-ups, structured, but
 *               it does not contain the prose.
 *   .csv      — the prose, but with every source URL stripped.
 *   .html     — the prose *and* the URLs, but as a rendered page.
 *
 * So this reads the HTML for what was said and where it came from, and run.json
 * for how well each value was sourced, and joins them on the subject label. The
 * output is committed: the site builds from a checked-in module rather than
 * parsing a document at runtime, and a regeneration shows up as a reviewable
 * diff rather than as a silent change in what the page claims.
 *
 * Usage: node scripts/build-research-data.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const RESEARCH = path.join(root, 'docs/research');
const OUT = path.join(root, 'packages/web/src/research-data.ts');

/** The order fields are presented in. The HTML emits them in rubric order. */
const FIELD_LABELS = {
  what: 'What it is',
  real_encoding: 'How it is really encoded',
  realistic_example: 'A realistic example',
  difficult_case: 'The difficult case',
  why_naive_breaks: 'Why the naive model breaks',
  robust_handling: 'Robust handling',
  standard: 'Standard',
  observability: 'Observability',
  severity: 'Severity',
};

function decode(html) {
  return html
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Splits a value into the claim and the trailing parenthetical the harness
 * appends when a value is reasoned rather than cited — "(Reasoned worked example
 * on a real route, not a published figure. …)". Kept apart so the page can show
 * the claim at full strength and the hedge as a hedge, instead of running them
 * together in one paragraph the way the generated HTML does.
 *
 * Deliberately conservative, because a wrong split silently demotes part of a
 * claim into a footnote: it fires only on a cited-free value ending in a
 * self-contained sentence in brackets. An ordinary aside — "(ITT)", "(FOQA in
 * North American usage)" — is too short and stays where the author put it.
 */
function splitCaveat(text, status) {
  if (status === 'cited') return { text, caveat: null };
  const match = /\s\(([A-Z][^()]{29,})\)\s*$/.exec(text);
  if (!match) return { text, caveat: null };
  return { text: text.slice(0, match.index).trim(), caveat: match[1].trim() };
}

const html = readFileSync(path.join(RESEARCH, 'telemetry-difficult-cases.html'), 'utf8');
const run = JSON.parse(readFileSync(path.join(RESEARCH, 'run.json'), 'utf8'));

// ── Subjects ────────────────────────────────────────────────────────────────

/** Status per (subject label, field key), from the run's own scoring. */
const statusByLabel = new Map();
for (const subject of run.score.scores) {
  const byKey = new Map();
  for (const field of subject.fields) byKey.set(field.key, field);
  statusByLabel.set(subject.label, { subject, byKey });
}

// Walk the document in order so each card picks up the group heading above it.
const TOKEN =
  /<h2 class="group">([^<]*)<\/h2>|<div class="card (done|partial)">([^]*?)<div class="prov">([^<]*)<\/div>/g;
const CARD_HEAD = /<span class="name">([^<]*)<\/span>/;
const META_ENTRY = /<div><span class="k">([a-z_]+)<\/span>\s*<b>([^]*?)<\/b><\/div>/g;
const LINK = /^<a href="([^"]+)"[^>]*>([^]*)<\/a>$/;

const subjects = [];
let group = null;

for (const token of html.matchAll(TOKEN)) {
  if (token[1] !== undefined) {
    group = decode(token[1]);
    continue;
  }

  const body = token[3];
  const label = decode(CARD_HEAD.exec(body)?.[1] ?? '');
  const scored = statusByLabel.get(label);
  if (!scored) throw new Error(`no run.json entry for subject "${label}"`);

  const fields = [];
  for (const entry of body.matchAll(META_ENTRY)) {
    const key = entry[1];
    const inner = entry[2].trim();
    const link = LINK.exec(inner);

    // A value carrying a source link is cited. Everything else was either
    // reasoned from mechanics the run *did* source ("flagged") or asserted from
    // model knowledge ("unverified"). run.json is the authority on which.
    const status = link
      ? 'cited'
      : scored.byKey.get(key)?.status === 'flagged'
        ? 'reasoned'
        : 'unverified';
    const { text, caveat } = splitCaveat(decode(link ? link[2] : inner), status);

    fields.push({
      key,
      label: FIELD_LABELS[key] ?? key.replace(/_/g, ' '),
      text,
      caveat,
      source: link ? link[1] : null,
      status,
      requirement: scored.byKey.get(key)?.requirement ?? 'optional',
    });
  }

  if (fields.length === 0) throw new Error(`no fields parsed for subject "${label}"`);

  const severity = fields.find((f) => f.key === 'severity')?.text ?? 'informational';

  subjects.push({
    id: scored.subject.id,
    label,
    group,
    severity: severity.toLowerCase(),
    complete: scored.subject.complete,
    score: scored.subject.score,
    // The one-line summary the card shows while collapsed. `what` is written as
    // the definition of the problem, so its first sentence is exactly that.
    summary: fields.find((f) => f.key === 'what')?.text.split(/(?<=\.)\s/)[0] ?? '',
    cited: fields.filter((f) => f.status === 'cited').length,
    fields: fields.filter((f) => f.key !== 'severity'),
  });
}

// ── Bubble-ups ──────────────────────────────────────────────────────────────

const bubbles = run.bubbles.map((b) => ({
  kind: b.kind,
  subjectId: b.subjectId,
  subject: run.score.scores.find((s) => s.id === b.subjectId)?.label ?? null,
  note: b.note,
  why: b.why,
  source: b.source ?? null,
}));

// ── Emit ────────────────────────────────────────────────────────────────────

const groups = [];
for (const subject of subjects) {
  const existing = groups.find((g) => g.name === subject.group);
  if (existing) existing.subjects.push(subject);
  else groups.push({ name: subject.group, subjects: [subject] });
}

const totals = {
  subjects: subjects.length,
  complete: run.score.completeCount,
  meanScore: run.score.meanScore,
  bubbles: bubbles.length,
  citedFields: subjects.reduce((n, s) => n + s.cited, 0),
  totalFields: subjects.reduce((n, s) => n + s.fields.length, 0),
  rounds: run.rounds.length,
  tokens: run.totalTokens,
};

const banner = `/*
 * GENERATED FILE — do not edit by hand.
 *
 * Produced by scripts/build-research-data.mjs from docs/research/. Change the
 * research artefacts and regenerate; an edit here is overwritten on the next run
 * and, worse, would make the page claim something the run did not.
 */`;

const source = `${banner}

/** How well a single value is sourced. */
export type Provenance =
  /** Carries a link to the standard or study it came from. */
  | 'cited'
  /** Worked out from cited mechanics, but not itself a published figure. */
  | 'reasoned'
  /** Asserted without a source, and marked as such rather than dressed up. */
  | 'unverified';

export interface ResearchField {
  key: string;
  label: string;
  text: string;
  /** The run's own note on why a value is reasoned rather than published. */
  caveat: string | null;
  source: string | null;
  status: Provenance;
  requirement: 'required' | 'preferred' | 'optional';
}

export interface ResearchSubject {
  id: string;
  label: string;
  group: string;
  severity: string;
  complete: boolean;
  score: number;
  summary: string;
  cited: number;
  fields: ResearchField[];
}

export interface ResearchGroup {
  name: string;
  subjects: ResearchSubject[];
}

export interface ResearchBubble {
  kind: string;
  subjectId: string;
  subject: string | null;
  note: string;
  why: string;
  source: string | null;
}

export const RESEARCH_TOTALS = ${JSON.stringify(totals, null, 2)} as const;

export const RESEARCH_GROUPS: ResearchGroup[] = ${JSON.stringify(groups, null, 2)};

export const RESEARCH_BUBBLES: ResearchBubble[] = ${JSON.stringify(bubbles, null, 2)};

export const RESEARCH_SUBJECTS: ResearchSubject[] = RESEARCH_GROUPS.flatMap((g) => g.subjects);
`;

writeFileSync(OUT, source);
console.log(
  `wrote ${path.relative(root, OUT)} — ${totals.subjects} subjects, ${groups.length} groups, ` +
    `${totals.citedFields}/${totals.totalFields} fields cited, ${bubbles.length} bubble-ups`,
);
