import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Credentials } from './Credentials.js';
import { CREDENTIALS, KIND_LABEL, KIND_ORDER } from '../credentials-data.js';
import { renderWithProviders } from '../test-utils.js';

/**
 * This is the one page in the console making claims about a person, so the
 * tests are about the claims rather than the layout: that every entry either
 * carries evidence a reader can open or says plainly that it does not, and that
 * the bundled certificate resolves against the published base path rather than
 * 404ing on the deployed site.
 */

describe('Credentials', () => {
  it('lists every entry, collapsed, under its own heading', () => {
    renderWithProviders(<Credentials />);

    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(CREDENTIALS.length);

    for (const credential of CREDENTIALS) {
      expect(
        screen.getByRole('button', { name: new RegExp(`^${escape(credential.title)}`) }),
      ).toBeVisible();
    }

    for (const kind of KIND_ORDER) {
      if (!CREDENTIALS.some((c) => c.kind === kind)) continue;
      expect(screen.getByRole('heading', { name: KIND_LABEL[kind] })).toBeVisible();
    }

    // The detail stays out of the document until asked for.
    expect(screen.queryByText(CREDENTIALS[0]!.detail)).toBeNull();
  });

  it('opens an entry and shows its evidence', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Credentials />);

    const credential = CREDENTIALS.find((c) => c.evidence.length > 0)!;
    await user.click(
      screen.getByRole('button', { name: new RegExp(`^${escape(credential.title)}`) }),
    );

    const body = document.getElementById(`credential-${credential.id}`)!;
    expect(within(body).getByText(credential.detail)).toBeVisible();

    for (const evidence of credential.evidence) {
      const link = within(body).getByRole('link', { name: new RegExp(escape(evidence.label)) });
      expect(link.getAttribute('href')).toContain(evidence.href.replace(/^\//, ''));
    }
  });

  it('resolves a bundled artefact against the published base path', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Credentials />);

    const certificate = CREDENTIALS.find((c) => c.evidence.some((e) => e.local))!;
    await user.click(
      screen.getByRole('button', { name: new RegExp(`^${escape(certificate.title)}`) }),
    );

    const link = screen.getByRole('link', { name: /Completion certificate/ });
    // Published under a subdirectory, so a root-relative href would 404. It has
    // to carry the base, whatever the base happens to be.
    expect(link.getAttribute('href')).toBe(
      `${import.meta.env.BASE_URL}credentials/aws-introduction-to-container-basics.pdf`,
    );
  });

  it('says so on an entry with nothing to link, rather than leaving it implied', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Credentials />);

    const unevidenced = CREDENTIALS.find((c) => c.evidence.length === 0)!;
    await user.click(
      screen.getByRole('button', { name: new RegExp(`^${escape(unevidenced.title)}`) }),
    );

    const body = document.getElementById(`credential-${unevidenced.id}`)!;
    expect(within(body).getByText(/No public artefact/)).toBeVisible();
    expect(within(body).queryAllByRole('link')).toHaveLength(0);
  });

  it('opens the entry named in the query string', () => {
    const credential = CREDENTIALS[1]!;
    renderWithProviders(<Credentials />, { route: `/credentials?item=${credential.id}` });

    expect(
      screen.getByRole('button', { name: new RegExp(`^${escape(credential.title)}`) }),
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens external evidence in a new tab and bundled files in place', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Credentials />);

    for (const credential of CREDENTIALS.filter((c) => c.evidence.length > 0)) {
      await user.click(
        screen.getByRole('button', { name: new RegExp(`^${escape(credential.title)}`) }),
      );
      const body = document.getElementById(`credential-${credential.id}`)!;

      for (const evidence of credential.evidence) {
        const link = within(body).getByRole('link', { name: new RegExp(escape(evidence.label)) });
        if (evidence.local) {
          expect(link).not.toHaveAttribute('target');
        } else {
          expect(link).toHaveAttribute('target', '_blank');
          expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
        }
      }
    }
  });
});

describe('credentials data', () => {
  it('gives every entry a date rather than a vague recency', () => {
    for (const credential of CREDENTIALS) {
      expect(credential.when).not.toMatch(/recent|lately|current/i);
      expect(credential.when.length).toBeGreaterThan(3);
    }
  });

  it('points every external link at a real scheme', () => {
    for (const credential of CREDENTIALS) {
      for (const evidence of credential.evidence.filter((e) => !e.local)) {
        expect(evidence.href).toMatch(/^https:\/\//);
      }
    }
  });
});

/** Escapes a title for use inside an accessible-name regular expression. */
function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
