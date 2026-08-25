import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Credentials } from './Credentials.js';
import { CREDENTIALS, KIND_LABEL, KIND_ORDER } from '../credentials-data.js';
import { renderWithProviders } from '../test-utils.js';

/**
 * This is the one page in the console making claims about a person, so the
 * tests are about the claims rather than the layout: that every entry either
 * carries evidence a reader can open or says plainly that it does not, that the
 * bundled certificates resolve against the published base path rather than
 * 404ing on the deployed site, and that the viewer gives the page back when it
 * is dismissed.
 */

const CERTIFICATE = CREDENTIALS.find((c) => c.evidence.some((e) => e.viewer))!;

async function openCard(user: ReturnType<typeof userEvent.setup>, title: string): Promise<void> {
  await user.click(screen.getByRole('button', { name: new RegExp(`^${escape(title)}`) }));
}

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

    const credential = CREDENTIALS.find((c) => c.evidence.some((e) => !e.viewer))!;
    await openCard(user, credential.title);

    const body = document.getElementById(`credential-${credential.id}`)!;
    expect(within(body).getByText(credential.detail)).toBeVisible();

    for (const evidence of credential.evidence.filter((e) => !e.viewer)) {
      const link = within(body).getByRole('link', { name: new RegExp(escape(evidence.label)) });
      expect(link.getAttribute('href')).toContain(evidence.href.replace(/^\//, ''));
    }
  });

  it('says so on an entry with nothing to link, rather than leaving it implied', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Credentials />);

    const unevidenced = CREDENTIALS.find((c) => c.evidence.length === 0)!;
    await openCard(user, unevidenced.title);

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

  it('opens external evidence in a new tab and bundled routes in place', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Credentials />);

    for (const credential of CREDENTIALS.filter((c) => c.evidence.length > 0)) {
      await openCard(user, credential.title);
      const body = document.getElementById(`credential-${credential.id}`)!;

      for (const evidence of credential.evidence.filter((e) => !e.viewer)) {
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

describe('the certificate viewer', () => {
  it('shows the certificate over the page rather than navigating away', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Credentials />);

    await openCard(user, CERTIFICATE.title);
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Completion certificate/ }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', expect.stringContaining(CERTIFICATE.title));

    // The card is still open behind it: the reader has not lost their place.
    expect(
      screen.getByRole('button', { name: new RegExp(`^${escape(CERTIFICATE.title)}`) }),
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('points the frame at the bundled file, resolved against the published base', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Credentials />);

    await openCard(user, CERTIFICATE.title);
    await user.click(screen.getByRole('button', { name: /Completion certificate/ }));

    const expected = `${import.meta.env.BASE_URL}${CERTIFICATE.evidence.find((e) => e.viewer)!.href}`;
    // Published under a subdirectory, so a root-relative src would 404 on the
    // deployed site while working perfectly in development.
    expect(document.querySelector('iframe.dv__frame')).toHaveAttribute('src', expected);
    expect(screen.getByRole('link', { name: /Open in a tab/ })).toHaveAttribute('href', expected);
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute('download');
  });

  it('locks the page behind it and gives the scroll back on close', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Credentials />);

    await openCard(user, CERTIFICATE.title);
    await user.click(screen.getByRole('button', { name: /Completion certificate/ }));
    expect(document.body.style.overflow).toBe('hidden');

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('closes on Escape and on the scrim', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Credentials />);

    await openCard(user, CERTIFICATE.title);

    await user.click(screen.getByRole('button', { name: /Completion certificate/ }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Completion certificate/ }));
    await user.click(screen.getByRole('button', { name: 'Close document' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('returns focus to the control that opened it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Credentials />);

    await openCard(user, CERTIFICATE.title);
    const opener = screen.getByRole('button', { name: /Completion certificate/ });

    await user.click(opener);
    await user.keyboard('{Escape}');

    // Otherwise a keyboard reader is dumped at the top of the document and has
    // to tab all the way back to where they were.
    expect(document.activeElement).toBe(opener);
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

  it('only sends bundled PDFs to the viewer', () => {
    for (const credential of CREDENTIALS) {
      for (const evidence of credential.evidence.filter((e) => e.viewer)) {
        expect(evidence.local).toBe(true);
        expect(evidence.href).toMatch(/\.pdf$/);
      }
    }
  });
});

/** Escapes a title for use inside an accessible-name regular expression. */
function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
