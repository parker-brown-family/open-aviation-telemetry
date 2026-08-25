/**
 * Credentials and accomplishments.
 *
 * The rule this page follows is the one the research page follows: a claim is
 * only worth making if a reader can check it. Every entry carries evidence —
 * a certificate you can open, a merged pull request you can read, a number with
 * the before and after that produced it. Anything that would need taking on
 * trust is written as what it is rather than dressed up.
 *
 * Ordered newest first within each group, because the question a reader is
 * usually asking is "what recently".
 */

export type CredentialKind = 'certification' | 'open-source' | 'engineering' | 'education';

export interface Evidence {
  label: string;
  /** Absolute URL, or a path relative to the site base for a bundled file. */
  href: string;
  /** Bundled files resolve against import.meta.env.BASE_URL at render. */
  local?: boolean;
  /**
   * Open in the document viewer rather than navigating.
   *
   * A certificate is something you glance at and dismiss. Sending the reader to
   * a PDF in a new tab costs them their place on this page and hands them a
   * browser chrome they then have to close; the viewer shows the thing over the
   * page and gives it back when they press Escape.
   */
  viewer?: boolean;
}

export interface Credential {
  id: string;
  kind: CredentialKind;
  title: string;
  issuer: string;
  /** Displayed as given. Absolute, never "recently". */
  when: string;
  /** The one line the collapsed card shows. */
  summary: string;
  /** The detail, shown when the card is opened. One paragraph per entry. */
  detail: string;
  /** What makes it checkable. An entry with none says so on the card. */
  evidence: Evidence[];
}

export const KIND_LABEL: Record<CredentialKind, string> = {
  certification: 'Certification',
  'open-source': 'Open source',
  engineering: 'Engineering',
  education: 'Education',
};

export const KIND_ORDER: CredentialKind[] = [
  'certification',
  'open-source',
  'engineering',
  'education',
];

export const CREDENTIALS: Credential[] = [
  {
    id: 'aws-eks-track',
    kind: 'certification',
    title: 'Why run Kubernetes workloads on Amazon EKS?',
    issuer: 'AWS Training and Certification',
    when: '25 August 2026',
    summary: 'The case for managed control planes — and what EKS takes off your hands.',
    detail:
      'What a managed control plane buys and what it costs: who patches the API server, what happens to etcd, and which of the operational burdens of self-hosted Kubernetes actually disappear rather than move. The third of three completions on the EKS track, and the one that argues for the choice this repository already made.',
    evidence: [
      {
        label: 'Completion certificate',
        href: 'credentials/aws-why-run-kubernetes-on-eks.pdf',
        local: true,
        viewer: true,
      },
      { label: 'The training plan it belongs to', href: 'training', local: true },
    ],
  },
  {
    id: 'aws-kubernetes-core-concepts',
    kind: 'certification',
    title: 'Introduction to Kubernetes Core Concepts',
    issuer: 'AWS Training and Certification',
    when: '25 August 2026',
    summary: 'Pods, services, deployments — the objects the Helm chart in this repo declares.',
    detail:
      'The Kubernetes object model: pods, services, deployments, and the reconciliation loop that makes declaring desired state a workable idea rather than a slogan. This repository ships a Helm umbrella chart that declares those objects, so this is the layer beneath what was already written by hand.',
    evidence: [
      {
        label: 'Completion certificate',
        href: 'credentials/aws-introduction-to-kubernetes-core-concepts.pdf',
        local: true,
        viewer: true,
      },
      { label: 'The training plan it belongs to', href: 'training', local: true },
    ],
  },
  {
    id: 'aws-container-basics',
    kind: 'certification',
    title: 'Introduction to Container Basics',
    issuer: 'AWS Training and Certification',
    when: '25 August 2026',
    summary: 'Where the EKS track starts: images, layers, and the container lifecycle.',
    detail:
      'Container fundamentals as AWS teaches them: images and layers, the container lifecycle, and where containers sit relative to the services that schedule them. The entry point to the EKS track rather than the destination — this repository already ships one image per service, so the value is the vocabulary and the AWS-specific framing rather than the mechanics.',
    evidence: [
      {
        label: 'Completion certificate',
        href: 'credentials/aws-introduction-to-container-basics.pdf',
        local: true,
        viewer: true,
      },
      { label: 'The training plan it belongs to', href: 'training', local: true },
    ],
  },
  {
    id: 'lean-ctx-upstream',
    kind: 'open-source',
    title: 'Six merged pull requests into lean-ctx',
    issuer: 'yvgude/lean-ctx — Rust context engine for AI agents, 3.6k stars',
    when: '2026',
    summary: 'About 1,600 lines landed in a third-party codebase, to the maintainer’s standards.',
    detail:
      'Diagnosed and filed the thundering-herd indexing issue (#460) after measuring nineteen concurrent indexer processes saturating a workstation, then landed both halves of the fix: a bounded rayon index pool (#468) and a cross-instance BM25 build lock mirroring the project’s own graph-lock pattern (#470). Also added delta-served explicit re-reads to the core read path (#463) and first-class support for the Augment coding agent across both of its config surfaces (#264, #267). Most of it came out of running a multi-agent context platform daily and hitting the limits first.',
    evidence: [
      {
        label: 'Issue #460 — thundering-herd indexing',
        href: 'https://github.com/yvgude/lean-ctx/issues/460',
      },
      {
        label: 'PR #468 — bounded rayon index pool',
        href: 'https://github.com/yvgude/lean-ctx/pull/468',
      },
      {
        label: 'PR #470 — cross-instance BM25 build lock',
        href: 'https://github.com/yvgude/lean-ctx/pull/470',
      },
      {
        label: 'PR #463 — delta-served explicit re-reads',
        href: 'https://github.com/yvgude/lean-ctx/pull/463',
      },
    ],
  },
  {
    id: 'own-tooling',
    kind: 'open-source',
    title: 'Terminal, editor and browser tooling, published',
    issuer: 'github.com/parker-brown-family',
    when: 'ongoing',
    summary: 'terminal-delight, markdown-delight and servo-agent — Rust, and shipped.',
    detail:
      'terminal-delight is a GPU-native Linux terminal built on gpui. markdown-delight is a tiling Markdown editor, also Rust. servo-agent is an agent-controllable browser on the Servo engine, shipped as an MCP server. They exist because the tools that were available did not do what was needed, which is the same reason this repository exists.',
    evidence: [
      { label: 'github.com/parker-brown-family', href: 'https://github.com/parker-brown-family' },
      {
        label: 'This repository',
        href: 'https://github.com/parker-brown-family/open-aviation-telemetry',
      },
    ],
  },
  {
    id: 'queue-pipeline',
    kind: 'engineering',
    title: 'A five-hour report cut to under thirty minutes',
    issuer: 'Acro Commerce — flagship enterprise contract',
    when: '2016–2026',
    summary: 'Three million rows a day moved off a brittle cron onto a fault-tolerant AWS queue.',
    detail:
      'A nightly cron report processing three million rows took five hours and failed in ways that needed a person. Rebuilt as a queue pipeline: large jobs chunked into batches, fed through a durable job queue to parallel workers, with the failure of one batch no longer the failure of the run. Ninety per cent faster, and the same shape as the asynchronous path in this repository — which is not a coincidence.',
    evidence: [],
  },
  {
    id: 'washboard-fft',
    kind: 'engineering',
    title: 'Spectral analysis that finds washboard on a gravel road',
    issuer: 'Intellimass — road intelligence',
    when: '2026',
    summary: 'An FFT and spectral-resonance method, better than half again on detection accuracy.',
    detail:
      'GPS-instrumented vehicle telemetry turned into surface-condition data for maintenance planning and evacuation preparedness, delivered to government stakeholders. The signal work is the part worth naming: an FFT and spectral-resonance analysis that separates washboard from ordinary roughness, a detection-accuracy improvement of more than fifty per cent over the conventional analysis it replaced.',
    evidence: [],
  },
  {
    id: 'okanagan-college',
    kind: 'education',
    title: 'Computer Information Systems diploma',
    issuer: 'Okanagan College — Dean’s List, co-op program',
    when: '2015–2017',
    summary: 'Where the ten years since started.',
    detail:
      'Two-year diploma with the co-op stream, on the Dean’s List. The co-op placement is what led into the decade of enterprise platform work that follows it.',
    evidence: [],
  },
];
