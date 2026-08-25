import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Training } from './Training.js';
import { TRAINING_ITEMS, TRAINING_STORAGE_KEY, stepLabel } from '../training-data.js';
import { renderWithProviders } from '../test-utils.js';

/**
 * The checklist is only useful if it remembers. A course finished on Tuesday has
 * to still be finished on Thursday, so the tests that matter here are the ones
 * about persistence — that a tap is written down, that a reload reads it back,
 * and that reset actually clears rather than only repainting.
 *
 * The build steps under each course carry the sharper claim — a finished course
 * proves you watched it, a finished step proves you changed something — so the
 * second half of this file checks that each step names real, distinct work, and
 * that done and not-done are told apart by more than colour.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.resolve(here, '../styles.css'), 'utf8');
const firstItem = TRAINING_ITEMS[0]!;

/*
 * Module-level rather than inside a describe: the checklist persists to
 * localStorage, so a test that leaves a course ticked changes what the next one
 * starts from. Scoping this to one describe leaves every other block sharing
 * state, which shows up as a test that passes alone and fails in the file.
 */
beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = '';
});

/**
 * Open the first course's step list and return it.
 *
 * Found through the disclosure's own aria-controls rather than by role: the
 * page has an outer list of courses, so getByRole('list') is ambiguous — and
 * following aria-controls also checks the wiring assistive tech depends on.
 */
async function openFirstSteps(): Promise<HTMLElement> {
  const disclosures = screen.getAllByRole('button', { name: /Build steps/ });
  const first = disclosures[0]!;
  await userEvent.click(first);
  const id = first.getAttribute('aria-controls')!;
  const panel = document.getElementById(id);
  if (!panel) throw new Error(`no panel with id ${id}`);
  return panel;
}

describe('Training checklist', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('lists every course with a link that still opens', () => {
    renderWithProviders(<Training />);

    for (const item of TRAINING_ITEMS) {
      expect(screen.getByRole('button', { name: new RegExp(escape(item.title)) })).toBeVisible();
    }

    const links = screen.getAllByRole('link', { name: /Open the course/ });
    expect(links).toHaveLength(TRAINING_ITEMS.length);
    for (const [index, link] of links.entries()) {
      expect(link).toHaveAttribute('href', TRAINING_ITEMS[index]!.url);
      // A checklist people work through over weeks gets opened in a new tab, or
      // they lose their place in the list every time.
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    }
  });

  it('starts with nothing launched', () => {
    renderWithProviders(<Training />);

    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(TRAINING_ITEMS.length);
    expect(screen.getByRole('heading', { name: /0\/9 launched/ })).toBeVisible();
  });

  it('marks a course launched on tap and writes it down', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Training />);

    const item = TRAINING_ITEMS[0]!;
    const row = screen.getByRole('button', { name: new RegExp(escape(item.title)) });

    await user.click(row);

    expect(row).toHaveAttribute('aria-pressed', 'true');
    expect(row.closest('li')).toHaveClass('is-launched');
    expect(JSON.parse(window.localStorage.getItem(TRAINING_STORAGE_KEY) ?? '[]')).toContain(
      item.id,
    );
  });

  it('reads the launched set back on a fresh visit', () => {
    const item = TRAINING_ITEMS[2]!;
    window.localStorage.setItem(TRAINING_STORAGE_KEY, JSON.stringify([item.id]));

    renderWithProviders(<Training />);

    expect(screen.getByRole('button', { name: new RegExp(escape(item.title)) })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('heading', { name: /1\/9 launched/ })).toBeVisible();
  });

  it('un-launches a course tapped a second time', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Training />);

    const item = TRAINING_ITEMS[1]!;
    const row = screen.getByRole('button', { name: new RegExp(escape(item.title)) });

    await user.click(row);
    await user.click(row);

    expect(row).toHaveAttribute('aria-pressed', 'false');
    expect(JSON.parse(window.localStorage.getItem(TRAINING_STORAGE_KEY) ?? '[]')).not.toContain(
      item.id,
    );
  });

  it('clears everything on reset, storage included', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Training />);

    const reset = screen.getByRole('button', { name: 'Reset checklist' });
    // Nothing to reset yet, so the control says so rather than doing nothing.
    expect(reset).toBeDisabled();

    await user.click(
      screen.getByRole('button', { name: new RegExp(escape(TRAINING_ITEMS[0]!.title)) }),
    );
    expect(reset).toBeEnabled();

    await user.click(reset);

    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(TRAINING_ITEMS.length);
    expect(JSON.parse(window.localStorage.getItem(TRAINING_STORAGE_KEY) ?? '[]')).toHaveLength(0);
  });

  it('survives a corrupted stored value rather than failing to render', () => {
    window.localStorage.setItem(TRAINING_STORAGE_KEY, '{not json');

    renderWithProviders(<Training />);

    expect(screen.getByRole('heading', { name: /0\/9 launched/ })).toBeVisible();
  });

  it('marks the areas no course covers', () => {
    renderWithProviders(<Training />);

    for (const item of TRAINING_ITEMS.filter((i) => i.gap)) {
      const row = screen.getByRole('button', { name: new RegExp(escape(item.title)) });
      // The gap areas carry the same dashed treatment the research page uses for
      // a value with no source, which is what the class name drives.
      expect(within(row).getByText(/Kafka|RabbitMQ/)).toHaveClass(`tr-area--${item.area}`);
    }
  });
});

/** Escapes a title for use inside an accessible-name regular expression. */
function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('the step data', () => {
  it('gives every course something to build', () => {
    for (const item of TRAINING_ITEMS) {
      expect(item.steps.length, `${item.id} has no build steps`).toBeGreaterThan(0);
    }
  });

  it('keeps every step id unique across the whole checklist', () => {
    // Course and step completion share one stored set, so a collision would
    // make ticking one thing tick another.
    const ids = [
      ...TRAINING_ITEMS.map((i) => i.id),
      ...TRAINING_ITEMS.flatMap((i) => i.steps).map((s) => s.id),
    ];
    expect(new Set(ids).size, 'duplicate id in the training checklist').toBe(ids.length);
  });

  it('prefixes each step id with its course, so the two cannot be confused', () => {
    for (const item of TRAINING_ITEMS) {
      for (const step of item.steps) {
        expect(step.id.startsWith(`${item.id}:`), `${step.id} is not under ${item.id}`).toBe(true);
      }
    }
  });

  it('does not repeat a step between courses', () => {
    const labels = TRAINING_ITEMS.flatMap((i) => i.steps).map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('states each step as work, not as a topic to read about', () => {
    // "Partitioning" is a subject. "Partition the telemetry table and confirm
    // the planner prunes" is a thing that is either done or not.
    for (const step of TRAINING_ITEMS.flatMap((i) => i.steps)) {
      expect(step.label.length, `${step.id} is too terse to act on`).toBeGreaterThan(24);
      expect(step.label[0], `${step.id} does not start with a capital`).toBe(
        step.label[0]!.toUpperCase(),
      );
    }
  });
});

describe('stepLabel', () => {
  it('counts a, b, c', () => {
    expect([0, 1, 2, 3].map(stepLabel)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('wraps rather than running past z', () => {
    expect(stepLabel(25)).toBe('z');
    expect(stepLabel(26)).toBe('a');
  });
});

describe('disclosure', () => {
  it('starts collapsed, so the course list stays readable', () => {
    // Nine courses times four steps is forty-five rows on open.
    render(<Training />);
    const disclosures = screen.getAllByRole('button', { name: /Build steps/ });
    expect(disclosures).toHaveLength(TRAINING_ITEMS.length);
    for (const button of disclosures) {
      expect(button).toHaveAttribute('aria-expanded', 'false');
    }
  });

  it('shows progress while collapsed, so opening is a choice not a requirement', () => {
    render(<Training />);
    const first = screen.getAllByRole('button', { name: /Build steps/ })[0]!;
    expect(first).toHaveTextContent(`0/${firstItem.steps.length}`);
  });

  it('expands and collapses again', async () => {
    render(<Training />);
    const first = screen.getAllByRole('button', { name: /Build steps/ })[0]!;

    await userEvent.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(firstItem.steps[0]!.label)).toBeInTheDocument();

    await userEvent.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(firstItem.steps[0]!.label)).toBeNull();
  });

  it('opens one course without opening the rest', async () => {
    render(<Training />);
    const disclosures = screen.getAllByRole('button', { name: /Build steps/ });
    await userEvent.click(disclosures[0]!);

    expect(disclosures[0]).toHaveAttribute('aria-expanded', 'true');
    expect(disclosures[1]).toHaveAttribute('aria-expanded', 'false');
  });

  it('points its control at the panel it opens', async () => {
    render(<Training />);
    const first = screen.getAllByRole('button', { name: /Build steps/ })[0]!;
    await userEvent.click(first);

    const controls = first.getAttribute('aria-controls')!;
    expect(document.getElementById(controls)).not.toBeNull();
  });
});

describe('the steps themselves', () => {
  it('labels them a, b, c in order', async () => {
    render(<Training />);
    const list = await openFirstSteps();
    const ords = [...list.querySelectorAll('.tr-step__ord')].map((n) => n.textContent);
    expect(ords).toEqual(firstItem.steps.map((_, i) => stepLabel(i)));
  });

  it('shows every step of that course and none of another', async () => {
    render(<Training />);
    const list = await openFirstSteps();
    for (const step of firstItem.steps) {
      expect(within(list).getByText(step.label)).toBeInTheDocument();
    }
    expect(within(list).queryAllByRole('listitem')).toHaveLength(firstItem.steps.length);
  });

  it('starts every step unchecked', async () => {
    render(<Training />);
    const list = await openFirstSteps();
    for (const button of within(list).getAllByRole('button')) {
      expect(button).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('checks a step off when its row is clicked', async () => {
    render(<Training />);
    const list = await openFirstSteps();
    const row = within(list).getAllByRole('button')[0]!;

    await userEvent.click(row);
    expect(row).toHaveAttribute('aria-pressed', 'true');
    expect(row.closest('li')).toHaveClass('is-done');
  });

  it('unchecks it again', async () => {
    render(<Training />);
    const list = await openFirstSteps();
    const row = within(list).getAllByRole('button')[0]!;

    await userEvent.click(row);
    await userEvent.click(row);
    expect(row).toHaveAttribute('aria-pressed', 'false');
    expect(row.closest('li')).not.toHaveClass('is-done');
  });

  it('checks only the step that was clicked', async () => {
    render(<Training />);
    const list = await openFirstSteps();
    const rows = within(list).getAllByRole('button');

    await userEvent.click(rows[1]!);
    expect(rows[0]).toHaveAttribute('aria-pressed', 'false');
    expect(rows[1]).toHaveAttribute('aria-pressed', 'true');
    expect(rows[2]).toHaveAttribute('aria-pressed', 'false');
  });

  it('does not launch the course when a step under it is checked', async () => {
    // They are separate claims: the steps are the work, the course is the
    // material. Finishing one build step is not finishing the course.
    render(<Training />);
    const list = await openFirstSteps();
    await userEvent.click(within(list).getAllByRole('button')[0]!);

    const courseRow = screen.getByRole('button', { name: new RegExp(firstItem.title) });
    expect(courseRow).toHaveAttribute('aria-pressed', 'false');
  });

  it('updates the collapsed count', async () => {
    render(<Training />);
    const first = screen.getAllByRole('button', { name: /Build steps/ })[0]!;
    const list = await openFirstSteps();

    await userEvent.click(within(list).getAllByRole('button')[0]!);
    expect(first).toHaveTextContent(`1/${firstItem.steps.length}`);
  });

  it('carries no aircraft — the departure belongs to the course row', async () => {
    render(<Training />);
    const list = await openFirstSteps();
    expect(list.querySelector('.tr-plane')).toBeNull();
  });
});

describe('telling done from not done', () => {
  it('draws a box for every step and a cross only on the finished ones', async () => {
    render(<Training />);
    const list = await openFirstSteps();

    expect(list.querySelectorAll('.tr-mark__box')).toHaveLength(firstItem.steps.length);
    expect(list.querySelectorAll('.tr-mark.is-done')).toHaveLength(0);

    await userEvent.click(within(list).getAllByRole('button')[0]!);
    expect(list.querySelectorAll('.tr-mark.is-done')).toHaveLength(1);
  });

  it('strikes the finished label through, rather than only greying it', async () => {
    // Colour alone is not a state anyone can see at a glance, and is invisible
    // to a reader who cannot distinguish it.
    const rule = /\.tr-step\.is-done \.tr-step__label\s*\{([^}]*)\}/.exec(css);
    expect(rule, '.tr-step.is-done .tr-step__label rule is missing').not.toBeNull();
    expect(rule![1]).toMatch(/text-decoration-line:\s*line-through/);
    expect(rule![1]).toMatch(/text-decoration-thickness/);
  });

  it('hides the cross until the step is finished', () => {
    const rule = /\.tr-mark__cross\s*\{([^}]*)\}/.exec(css);
    expect(rule, '.tr-mark__cross rule is missing').not.toBeNull();
    expect(rule![1]).toMatch(/opacity:\s*0/);
  });

  it('gives the row a click target far larger than the 16px box', async () => {
    // A checkbox-sized target is a miss waiting to happen on a phone.
    const rule = /\.tr-step__toggle\s*\{([^}]*)\}/.exec(css);
    expect(rule, '.tr-step__toggle rule is missing').not.toBeNull();
    expect(rule![1], 'the row is not full width').toMatch(/width:\s*100%/);
    expect(rule![1], 'the row has no vertical padding').toMatch(/padding:\s*9px/);
  });

  it('gives the row a visible keyboard focus ring', () => {
    expect(css).toMatch(/\.tr-step__toggle:focus-visible\s*\{[^}]*outline:/);
  });
});

describe('remembering progress', () => {
  it('persists a checked step', async () => {
    render(<Training />);
    const list = await openFirstSteps();
    await userEvent.click(within(list).getAllByRole('button')[0]!);

    const stored: unknown = JSON.parse(window.localStorage.getItem(TRAINING_STORAGE_KEY) ?? '[]');
    expect(stored).toContain(firstItem.steps[0]!.id);
  });

  it('restores checked steps on the next visit', async () => {
    window.localStorage.setItem(
      TRAINING_STORAGE_KEY,
      JSON.stringify([firstItem.steps[0]!.id, firstItem.steps[1]!.id]),
    );

    render(<Training />);
    const first = screen.getAllByRole('button', { name: /Build steps/ })[0]!;
    expect(first).toHaveTextContent(`2/${firstItem.steps.length}`);
  });

  it('counts built steps in the page summary', () => {
    window.localStorage.setItem(TRAINING_STORAGE_KEY, JSON.stringify([firstItem.steps[0]!.id]));
    render(<Training />);
    expect(screen.getByText(/1 built/)).toBeInTheDocument();
  });

  it('clears steps as well as courses on reset', async () => {
    window.localStorage.setItem(
      TRAINING_STORAGE_KEY,
      JSON.stringify([firstItem.id, firstItem.steps[0]!.id]),
    );
    render(<Training />);

    await userEvent.click(screen.getByRole('button', { name: 'Reset checklist' }));
    const first = screen.getAllByRole('button', { name: /Build steps/ })[0]!;
    expect(first).toHaveTextContent(`0/${firstItem.steps.length}`);
  });
});
