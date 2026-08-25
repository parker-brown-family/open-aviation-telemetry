#!/usr/bin/env node
/*
 * Extracts the Architecture Explorer's code examples from the real repository
 * and emits a typed module the web client imports.
 *
 * WHY THIS IS A GENERATOR AND NOT A HAND-WRITTEN FILE
 * --------------------------------------------------
 * The whole value of the Examples tab is that it shows the ACTUAL code that
 * implements the component you clicked, at the path it lives at. Pasted
 * snippets stop being that within a week — they become a claim about the code
 * rather than the code. So nothing here is authored: every excerpt is sliced
 * out of a real file at build time, and captured outputs are read from files
 * that were genuinely produced by a running stack.
 *
 * Excerpts are located by ANCHOR strings rather than line numbers, because line
 * numbers rot on the first unrelated edit above them. If an anchor is not
 * found, this script FAILS rather than emitting an empty example — a silently
 * missing excerpt would be the same drift problem in a new costume.
 *
 *   node scripts/build-code-examples.mjs
 *
 * Output: packages/web/src/generated/code-examples.ts (committed, so a plain
 * `pnpm build` needs no extra step).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(repo, 'packages/web/src/generated/code-examples.ts');

/**
 * The manifest: which examples belong to which architecture node.
 *
 *   from / to  slice between the first line containing `from` and the first
 *              line containing `to` after it. `to` is exclusive unless
 *              `inclusive` is set.
 *   whole      take the entire file (small files only).
 *   captured   a file under docs/captured — real output from a running stack,
 *              not a source excerpt. Rendered with a different badge because it
 *              is evidence rather than code.
 */
const MANIFEST = {
  api: [
    {
      title: 'Publish to the stream before writing the projection',
      file: 'packages/telemetry-api/src/routes/fleet.ts',
      lang: 'ts',
      from: '// Publish BEFORE writing the projection.',
      to: 'metrics.increment(METRIC.telemetryAccepted);',
    },
    {
      title: 'The telemetry contract every service shares',
      file: 'packages/shared/src/telemetry.ts',
      lang: 'ts',
      from: 'export const TelemetryReportSchema',
      to: 'export type Position',
    },
    {
      title: 'A real 202, from the running stack',
      file: 'docs/captured/ingest-202.json',
      lang: 'json',
      captured: true,
      whole: true,
    },
    {
      title: 'A real 400 — the offending field is named',
      file: 'docs/captured/ingest-400.json',
      lang: 'json',
      captured: true,
      whole: true,
    },
  ],

  kafka: [
    {
      title: 'Why the partition key is aircraft_id',
      file: 'packages/shared/src/events.ts',
      lang: 'ts',
      from: '/**\n * Partition key = aircraft_id.',
      to: 'export function isReplay',
    },
    {
      title: 'Consumer lag, read from the broker',
      file: 'docs/captured/stats.json',
      lang: 'json',
      captured: true,
      whole: true,
    },
  ],

  consumer: [
    {
      title: 'Quarantine what can never succeed; retry what might',
      file: 'packages/telemetry-consumer/src/processor.ts',
      lang: 'ts',
      from: '/**\n * Parses and validates a raw Kafka message value.',
      to: 'export interface DerivedState',
    },
    {
      title: 'Per-aircraft state, safe because of the partition key',
      file: 'packages/telemetry-consumer/src/processor.ts',
      lang: 'ts',
      from: 'export class RecentStateCache',
      to: 'export type ParseOutcome',
    },
  ],

  rabbit: [
    {
      title: 'The retry topology — a delay queue with no consumer',
      file: 'packages/service-kit/src/rabbit.ts',
      lang: 'ts',
      whole: true,
    },
  ],

  worker: [
    {
      title: 'Retry three times through the delay queue, then dead-letter',
      file: 'packages/report-worker/src/main.ts',
      lang: 'ts',
      from: 'const outcome = decideFailureOutcome',
      to: 'metrics.increment(METRIC.deadLettered);',
      inclusive: true,
    },
    {
      title: 'The policy decision, kept pure and testable',
      file: 'packages/report-worker/src/summary.ts',
      lang: 'ts',
      from: 'export function decideFailureOutcome',
      to: null,
    },
  ],

  rds: [
    {
      title: 'A replayed event collides instead of duplicating',
      file: 'packages/data/src/repository.ts',
      lang: 'ts',
      from: '/**\n * Appends to history.',
      to: '/** Records an event id.',
    },
    {
      title: 'The idempotency ledger, in the schema',
      file: 'packages/data/migrations/001_init.sql',
      lang: 'sql',
      from: '-- The idempotency ledger.',
      to: null,
    },
  ],

  eks: [
    {
      title: 'Liveness and readiness are different checks',
      file: 'charts/open-aviation-telemetry/templates/workloads.yaml',
      lang: 'yaml',
      from: '# Liveness and readiness are deliberately different checks.',
      to: 'startupProbe:',
    },
  ],

  terraform: [
    {
      title: 'One IAM role per application — the worker gets no Kafka access',
      file: 'infra/terraform/environments/demo/main.tf',
      lang: 'hcl',
      from: '  workload_service_accounts = {',
      to: '  tags = local.tags',
    },
  ],

  observability: [
    {
      title: 'Liveness must not fail because a broker blipped',
      file: 'packages/telemetry-api/src/routes/ops.ts',
      lang: 'ts',
      from: '  // -------------------------------------------------------------------------\n  // Probes',
      to: "  app.get(\n    '/metrics'",
    },
    {
      title: 'Real /metrics output, from the running stack',
      file: 'docs/captured/metrics.txt',
      lang: 'text',
      captured: true,
      whole: true,
    },
    {
      title: 'Real /ready output — every dependency named',
      file: 'docs/captured/ready.json',
      lang: 'json',
      captured: true,
      whole: true,
    },
  ],

  alb: [
    {
      title: 'One host, two backends — so CORS never enters the deployment',
      file: 'charts/open-aviation-telemetry/templates/ingress.yaml',
      lang: 'yaml',
      from: '  rules:',
      to: null,
    },
  ],

  client: [
    {
      title: 'Deciding whether an API is really there',
      file: 'packages/web/src/data-source.tsx',
      lang: 'tsx',
      from: '    const probe = async (): Promise<void> => {',
      to: '    void probe();',
    },
  ],
};

/** Strip a common leading indent so an excerpt reads flush in the panel. */
function dedent(lines) {
  const indents = lines
    .filter((l) => l.trim().length > 0)
    .map((l) => l.length - l.trimStart().length);
  const min = indents.length > 0 ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min));
}

function fail(message) {
  console.error(`build-code-examples: ${message}`);
  process.exit(1);
}

/** Index of the line beginning a multi-line anchor, or -1. */
function findAnchor(lines, anchor, startAt = 0) {
  const needle = anchor.split('\n');
  for (let i = startAt; i <= lines.length - needle.length; i += 1) {
    if (needle.every((n, k) => lines[i + k]?.includes(n.trim()))) return i;
  }
  return -1;
}

function extract(spec) {
  const abs = path.join(repo, spec.file);
  let raw;
  try {
    raw = readFileSync(abs, 'utf8');
  } catch {
    fail(`cannot read ${spec.file}`);
  }
  const lines = raw.replace(/\s+$/, '').split('\n');

  if (spec.whole) {
    return { code: lines.join('\n'), startLine: 1, endLine: lines.length };
  }

  const start = findAnchor(lines, spec.from);
  if (start < 0) fail(`anchor not found in ${spec.file}: ${JSON.stringify(spec.from)}`);

  let end;
  if (spec.to === null || spec.to === undefined) {
    end = lines.length;
  } else {
    const found = findAnchor(lines, spec.to, start + 1);
    if (found < 0) fail(`end anchor not found in ${spec.file}: ${JSON.stringify(spec.to)}`);
    end = spec.inclusive ? found + 1 : found;
  }

  // Trim trailing blank lines so excerpts do not end in whitespace.
  let slice = lines.slice(start, end);
  while (slice.length > 0 && slice[slice.length - 1].trim() === '') slice.pop();

  return {
    code: dedent(slice).join('\n'),
    startLine: start + 1,
    endLine: start + slice.length,
  };
}

const examples = {};
let count = 0;

for (const [nodeId, specs] of Object.entries(MANIFEST)) {
  examples[nodeId] = specs.map((spec) => {
    const { code, startLine, endLine } = extract(spec);
    count += 1;
    return {
      title: spec.title,
      file: spec.file,
      lang: spec.lang,
      captured: spec.captured === true,
      startLine,
      endLine,
      code,
    };
  });
}

mkdirSync(path.dirname(OUT), { recursive: true });

const banner = `/* GENERATED by scripts/build-code-examples.mjs — do not edit.
 *
 * Every excerpt below was sliced out of a real file in this repository, and
 * every "captured" entry is real output from a running stack. Regenerate with:
 *
 *   node scripts/build-code-examples.mjs
 *
 * The generator locates excerpts by anchor string and FAILS if an anchor has
 * moved, so this file cannot quietly drift away from the code it quotes.
 */`;

const body = `${banner}

export interface CodeExample {
  title: string;
  /** Repository-relative path the excerpt came from. */
  file: string;
  lang: string;
  /** True when this is captured output from a running stack, not source. */
  captured: boolean;
  startLine: number;
  endLine: number;
  code: string;
}

export const CODE_EXAMPLES: Record<string, CodeExample[]> = ${JSON.stringify(examples, null, 2)};

export const CODE_EXAMPLE_COUNT = ${count};
`;

writeFileSync(OUT, body);
console.log(
  `build-code-examples: ${count} examples across ${Object.keys(examples).length} components → ${path.relative(repo, OUT)}`,
);
