import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Research } from './Research.js';
import { RESEARCH_GROUPS, RESEARCH_SUBJECTS, RESEARCH_TOTALS } from '../research-data.js';
import { renderWithProviders } from '../test-utils.js';

/**
 * What is worth testing here is not the layout, it is the honesty of the page:
 * that a case is collapsed until asked for, that every value says how well it is
 * sourced, and that a cited value actually carries the link the run recorded. A
 * page that quietly presented an unsourced value as fact would be the one defect
 * that matters, because the whole point of the research run was that a value
 * with no source does not count.
 */

describe('Research page', () => {
  it('lists every case, collapsed, with its severity', () => {
    renderWithProviders(<Research />);

    const heads = screen.getAllByRole('button', { expanded: false });
    // Every case plus nothing else: the expand/collapse controls are not
    // disclosure buttons and carry no aria-expanded.
    expect(heads).toHaveLength(RESEARCH_TOTALS.subjects);

    for (const subject of RESEARCH_SUBJECTS) {
      expect(screen.getByRole('button', { name: new RegExp(escape(subject.label)) })).toBeVisible();
    }

    // Nothing from a case body is on the page until a case is opened.
    const first = RESEARCH_SUBJECTS[0]!;
    expect(screen.queryByText(first.fields[0]!.text)).toBeNull();
  });

  it('opens a case on click and closes it again', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Research />);

    const subject = RESEARCH_SUBJECTS[0]!;
    const head = screen.getByRole('button', { name: new RegExp(escape(subject.label)) });

    await user.click(head);
    expect(head).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(subject.fields[0]!.text)).toBeVisible();

    await user.click(head);
    expect(head).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(subject.fields[0]!.text)).toBeNull();
  });

  it('opens the case named in the query string', () => {
    const subject = RESEARCH_SUBJECTS[3]!;
    renderWithProviders(<Research />, { route: `/research?case=${subject.id}` });

    expect(screen.getByRole('button', { name: new RegExp(escape(subject.label)) })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText(subject.fields[0]!.text)).toBeVisible();
  });

  it('labels every value with how well it is sourced, and links the cited ones', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Research />);

    // A case chosen because it has both cited and uncited values.
    const subject = RESEARCH_SUBJECTS.find((s) => s.cited > 0 && s.cited < s.fields.length);
    expect(subject).toBeDefined();

    await user.click(screen.getByRole('button', { name: new RegExp(escape(subject!.label)) }));
    const body = document.getElementById(`case-${subject!.id}`);
    expect(body).not.toBeNull();

    for (const field of subject!.fields) {
      const term = within(body!).getByText(field.label).closest('dt');
      expect(term).not.toBeNull();
      const tag = within(term!).getByText(field.status === 'cited' ? 'sourced' : field.status);
      expect(tag).toBeVisible();
    }

    // Every cited value carries the source the run recorded, not a bare claim.
    const links = within(body!).getAllByRole('link', { name: /source/ });
    expect(links).toHaveLength(subject!.cited);
    const hrefs = links.map((a) => a.getAttribute('href'));
    for (const field of subject!.fields.filter((f) => f.source)) {
      expect(hrefs).toContain(field.source);
    }
  });

  it('filters cases by anything they say, and opens what matched', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Research />);

    // "PT6A" appears in the body of the turbine case and nowhere in its title,
    // so a filter that only searched titles would return nothing.
    await user.type(screen.getByLabelText('Filter cases'), 'PT6A');

    const heads = screen.getAllByRole('button', { expanded: true });
    expect(heads.length).toBeGreaterThan(0);
    expect(heads.length).toBeLessThan(RESEARCH_TOTALS.subjects);
    expect(heads.some((h) => /turbine/i.test(h.textContent ?? ''))).toBe(true);
  });

  it('says so when a filter matches nothing rather than showing an empty page', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Research />);

    await user.type(screen.getByLabelText('Filter cases'), 'zzzznotathing');

    expect(screen.getByText(/No case mentions/)).toBeVisible();
    expect(screen.queryAllByRole('button', { expanded: true })).toHaveLength(0);
  });

  it('expands and collapses every case at once', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Research />);

    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getAllByRole('button', { expanded: true })).toHaveLength(
      RESEARCH_TOTALS.subjects,
    );

    await user.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(screen.queryAllByRole('button', { expanded: true })).toHaveLength(0);
  });

  it('groups the cases the way the run clustered them', () => {
    renderWithProviders(<Research />);

    for (const group of RESEARCH_GROUPS) {
      expect(screen.getByRole('heading', { name: group.name })).toBeVisible();
    }
  });
});

describe('research data', () => {
  it('carries a source URL for every value it calls cited, and none for the rest', () => {
    for (const subject of RESEARCH_SUBJECTS) {
      for (const field of subject.fields) {
        if (field.status === 'cited') expect(field.source).toMatch(/^https?:\/\//);
        else expect(field.source).toBeNull();
      }
    }
  });

  it('matches the run totals it was generated from', () => {
    expect(RESEARCH_SUBJECTS).toHaveLength(RESEARCH_TOTALS.subjects);
    expect(RESEARCH_SUBJECTS.every((s) => s.fields.length > 0)).toBe(true);
    expect(RESEARCH_SUBJECTS.reduce((n, s) => n + s.cited, 0)).toBe(RESEARCH_TOTALS.citedFields);
  });

  it('gives every case a one-line summary short enough to sit on a row', () => {
    for (const subject of RESEARCH_SUBJECTS) {
      expect(subject.summary.length).toBeGreaterThan(0);
      expect(subject.summary.length).toBeLessThan(400);
    }
  });
});

/** Escapes a label for use inside an accessible-name regular expression. */
function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
