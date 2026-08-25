import { beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Training } from './Training.js';
import { TRAINING_ITEMS, TRAINING_STORAGE_KEY } from '../training-data.js';
import { renderWithProviders } from '../test-utils.js';

/**
 * The checklist is only useful if it remembers. A course finished on Tuesday has
 * to still be finished on Thursday, so the tests that matter here are the ones
 * about persistence — that a tap is written down, that a reload reads it back,
 * and that reset actually clears rather than only repainting.
 */

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
