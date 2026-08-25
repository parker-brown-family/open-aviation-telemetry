import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ARCH_NODES, NODE_BY_ID } from '../architecture.js';
import { CODE_EXAMPLES } from '../generated/code-examples.js';
import { NodeDetail } from './NodeDetail.js';

/**
 * The Examples tab is only worth having if the examples are real.
 *
 * A pasted snippet is a claim about the code; within a week it is a claim that
 * happens to be false. So the excerpts are generated out of the repository at
 * build time, and these tests check the two things that make that trustworthy:
 * the files quoted exist at the paths shown, and the excerpt still appears in
 * the file it says it came from.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');

const api = NODE_BY_ID.get('api')!;

describe('NodeDetail tabs', () => {
  it('opens on the explanation', () => {
    render(<NodeDetail node={api} />);
    expect(screen.getByRole('tab', { name: 'Explanation' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('What it is')).toBeInTheDocument();
  });

  it('switches to the examples', async () => {
    render(<NodeDetail node={api} />);
    await userEvent.click(screen.getByRole('tab', { name: /Examples/ }));
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'panel-examples');
    expect(screen.queryByText('What it is')).toBeNull();
  });

  it('shows how many examples a component has', () => {
    render(<NodeDetail node={api} />);
    const count = CODE_EXAMPLES['api']?.length ?? 0;
    expect(screen.getByRole('tab', { name: /Examples/ })).toHaveTextContent(String(count));
  });

  it('returns to the explanation when a different component is selected', async () => {
    // Carrying the Examples tab across drops the reader into the middle of
    // something they have not been introduced to yet.
    const { rerender } = render(<NodeDetail node={api} />);
    await userEvent.click(screen.getByRole('tab', { name: /Examples/ }));
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'panel-examples');

    rerender(<NodeDetail node={NODE_BY_ID.get('rds')!} />);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'panel-explanation');
  });

  it('disables the tab for a component with no examples', () => {
    const bare = { ...api, id: 'nonexistent-component' };
    render(<NodeDetail node={bare} />);
    expect(screen.getByRole('tab', { name: /Examples/ })).toBeDisabled();
  });

  it('answers every question the explanation promises', () => {
    // The panel's worth is that no component gets a shallower answer than any
    // other: each one says how it fails and how it scales, not only what it is.
    render(<NodeDetail node={NODE_BY_ID.get('rds')!} />);
    for (const heading of [
      'What it is',
      'Why it is here',
      'What was considered instead',
      'How it fails',
      'How it scales',
      'Security',
      'Running locally',
      'In the repository',
    ]) {
      expect(screen.getByText(heading), `${heading} is missing`).toBeInTheDocument();
    }
  });
});

describe('the rendered examples', () => {
  it('shows the file and line range each excerpt came from', async () => {
    render(<NodeDetail node={api} />);
    await userEvent.click(screen.getByRole('tab', { name: /Examples/ }));

    const first = CODE_EXAMPLES['api']![0]!;
    expect(
      screen.getByText(`${first.file}:${first.startLine}–${first.endLine}`),
    ).toBeInTheDocument();
  });

  it('links the path to the file on GitHub at those lines', async () => {
    render(<NodeDetail node={api} />);
    await userEvent.click(screen.getByRole('tab', { name: /Examples/ }));

    const first = CODE_EXAMPLES['api']![0]!;
    const link = screen.getByText(`${first.file}:${first.startLine}–${first.endLine}`);
    expect(link).toHaveAttribute(
      'href',
      expect.stringContaining(`/${first.file}#L${first.startLine}-L${first.endLine}`),
    );
  });

  it('badges captured output so it is not mistaken for source', async () => {
    // Same honesty rule as the data-source banner: an excerpt from a file and a
    // response from a running stack are different kinds of evidence.
    const { container } = render(<NodeDetail node={api} />);
    await userEvent.click(screen.getByRole('tab', { name: /Examples/ }));

    // Counted by badge, not by the words: the panel's own note explains what
    // the badge means, so a text match would count that sentence as a third.
    const capturedCount = CODE_EXAMPLES['api']!.filter((e) => e.captured).length;
    expect(capturedCount).toBeGreaterThan(0);
    expect(container.querySelectorAll('.ex__badge')).toHaveLength(capturedCount);
  });

  it('numbers lines from the real position in the file', async () => {
    render(<NodeDetail node={api} />);
    await userEvent.click(screen.getByRole('tab', { name: /Examples/ }));

    const first = CODE_EXAMPLES['api']![0]!;
    // The first rendered line number is the file's line, not 1.
    expect(first.startLine).toBeGreaterThan(1);
    expect(screen.getAllByText(String(first.startLine)).length).toBeGreaterThan(0);
  });
});

describe('the generated examples are real', () => {
  const all = Object.entries(CODE_EXAMPLES).flatMap(([nodeId, list]) =>
    list.map((example) => ({ nodeId, example })),
  );

  it('covers every component in the diagram', () => {
    for (const node of ARCH_NODES) {
      expect(CODE_EXAMPLES[node.id]?.length ?? 0, `${node.id} has no examples`).toBeGreaterThan(0);
    }
  });

  it('quotes files that exist at the paths shown', () => {
    for (const { nodeId, example } of all) {
      expect(
        existsSync(path.join(repo, example.file)),
        `${nodeId}: ${example.file} does not exist`,
      ).toBe(true);
    }
  });

  it('quotes code that is still in the file it came from', () => {
    // The real drift guard. If someone edits a source file, the excerpt stops
    // matching and this fails — which is the signal to regenerate.
    for (const { nodeId, example } of all) {
      const source = readFileSync(path.join(repo, example.file), 'utf8');
      const firstLine = example.code.split('\n').find((l) => l.trim().length > 0)!;
      expect(
        source.includes(firstLine.trim()),
        `${nodeId}: ${example.file} no longer contains its excerpt — rerun scripts/build-code-examples.mjs`,
      ).toBe(true);
    }
  });

  it('reports a line range that matches the excerpt length', () => {
    for (const { nodeId, example } of all) {
      const lines = example.code.split('\n').length;
      expect(example.endLine - example.startLine + 1, `${nodeId}: ${example.file}`).toBe(lines);
    }
  });

  it('takes every captured example from docs/captured, and nothing else', () => {
    for (const { example } of all) {
      if (example.captured) {
        expect(example.file.startsWith('docs/captured/')).toBe(true);
      } else {
        expect(example.file.startsWith('docs/captured/')).toBe(false);
      }
    }
  });

  it('does not ship an empty excerpt', () => {
    for (const { nodeId, example } of all) {
      expect(example.code.trim().length, `${nodeId}: ${example.file} is empty`).toBeGreaterThan(20);
    }
  });
});
