import { useEffect, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Layout } from './components/Layout.js';
import { useDataSource } from './data-source.js';
import {
  renderWithProviders,
  stubApiOffline,
  stubApiOnline,
  stubApiServingHtml,
  stubApiStatus,
} from './test-utils.js';

/**
 * These are the most important tests in the web package.
 *
 * This client is published as a static page where no API is attached, and it is
 * also run locally against the full stack. If the two ever became
 * indistinguishable — sample numbers rendered without saying they are sample
 * numbers — the page would be making a false claim about a running system.
 * That is a correctness bug, so it gets tests.
 */

function Probe(): React.JSX.Element {
  const { mode, apiBaseUrl } = useDataSource();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="base">{apiBaseUrl}</span>
    </div>
  );
}

describe('data source detection', () => {
  it('reports live when the API answers', async () => {
    stubApiOnline();
    renderWithProviders(<Probe />);
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('live'));
  });

  it('falls back to sample when the API is unreachable', async () => {
    stubApiOffline();
    renderWithProviders(<Probe />);
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('sample'));
  });

  it('treats a non-2xx response as no API, not as a live one', async () => {
    // A misconfigured reverse proxy returning 404 for /api must not be mistaken
    // for a working backend.
    stubApiStatus(404);
    renderWithProviders(<Probe />);
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('sample'));
  });

  it('treats a 500 from the API as no usable API', async () => {
    stubApiStatus(500);
    renderWithProviders(<Probe />);
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('sample'));
  });

  it('starts in a probing state rather than claiming either', () => {
    stubApiOffline();
    renderWithProviders(<Probe />);
    expect(screen.getByTestId('mode')).toHaveTextContent('probing');
  });

  it('is not fooled by a static host answering 200 with its own index.html', async () => {
    // This is the exact situation the published page is in: a file server that
    // returns the SPA shell for any unmatched path. A 200 is not evidence of an
    // API, so the body has to be checked too.
    stubApiServingHtml();
    renderWithProviders(<Probe />);
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('sample'));
  });

  it('rejects a 200 whose JSON is not this API', async () => {
    stubApiOnline({ something: 'else' });
    renderWithProviders(<Probe />);
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('sample'));
  });

  it('explains an unreachable API in words, not in browser error text', async () => {
    stubApiOffline('Failed to fetch');
    renderWithProviders(
      <Layout>
        <p>content</p>
      </Layout>,
    );
    await screen.findByText(/SAMPLE DATA/);
    expect(screen.getByRole('status')).toHaveTextContent(/no API responded at this address/i);
    expect(screen.getByRole('status')).not.toHaveTextContent(/Unexpected token/i);
  });
});

describe('the data-source banner', () => {
  it('states plainly that nothing is measured when offline', async () => {
    stubApiOffline();
    renderWithProviders(
      <Layout>
        <p>content</p>
      </Layout>,
    );

    const banner = await screen.findByText(/SAMPLE DATA/);
    expect(banner).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/nothing here is being measured/i);
  });

  it('says what it is connected to when live', async () => {
    stubApiOnline();
    renderWithProviders(
      <Layout>
        <p>content</p>
      </Layout>,
    );

    await screen.findByText(/LIVE/);
    expect(screen.getByRole('status')).toHaveTextContent(/measured from the running system/i);
  });

  it('is always present — there is no way to dismiss it', async () => {
    stubApiOffline();
    renderWithProviders(
      <Layout>
        <p>content</p>
      </Layout>,
    );
    await screen.findByText(/SAMPLE DATA/);

    // The only button in the banner is the re-check; no dismiss control exists.
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Re-check']);
  });

  it('re-checks on demand and switches to live when the API appears', async () => {
    stubApiOffline();
    renderWithProviders(
      <Layout>
        <p>content</p>
      </Layout>,
    );
    await screen.findByText(/SAMPLE DATA/);

    stubApiOnline();
    await userEvent.click(screen.getByRole('button', { name: 'Re-check' }));

    await screen.findByText(/LIVE/);
  });
});

/**
 * Renders the result of one client call, so a test can assert on what the
 * offline client actually does rather than on how it is wired.
 */
function ClientProbe({
  call,
}: {
  call: (client: ReturnType<typeof useDataSource>['client']) => Promise<unknown>;
}): React.JSX.Element {
  const { client, mode } = useDataSource();
  const [outcome, setOutcome] = useState<string>('pending');

  useEffect(() => {
    if (mode === 'probing') return;
    let cancelled = false;
    void call(client)
      .then((value) => {
        if (!cancelled) setOutcome(`resolved:${JSON.stringify(value).slice(0, 120)}`);
      })
      .catch((err: Error) => {
        if (!cancelled) setOutcome(`rejected:${err.message}`);
      });
    return () => {
      cancelled = true;
    };
  }, [client, mode, call]);

  return <span data-testid="outcome">{outcome}</span>;
}

describe('the offline sample client', () => {
  it('serves reads, so the published page is not blank', async () => {
    stubApiOffline();
    renderWithProviders(<ClientProbe call={(client) => client.aircraft()} />);

    const outcome = await screen.findByTestId('outcome');
    await waitFor(() => expect(outcome.textContent).toMatch(/^resolved:/));
    expect(outcome.textContent).toMatch(/"count":\d+/);
  });

  it('serves the fleet statistics the dashboard needs', async () => {
    stubApiOffline();
    renderWithProviders(<ClientProbe call={(client) => client.stats()} />);

    const outcome = await screen.findByTestId('outcome');
    await waitFor(() => expect(outcome.textContent).toMatch(/^resolved:/));
  });

  it('rejects writes rather than pretending they worked', async () => {
    stubApiOffline();
    renderWithProviders(<ClientProbe call={(client) => client.demoStart('calm')} />);

    const outcome = await screen.findByTestId('outcome');
    await waitFor(() => expect(outcome.textContent).toMatch(/^rejected:/));
    expect(outcome.textContent).toMatch(/no API is attached/i);
  });

  it('rejects a report request rather than returning a fake report id', async () => {
    stubApiOffline();
    renderWithProviders(<ClientProbe call={(client) => client.requestReport('C-GABC')} />);

    const outcome = await screen.findByTestId('outcome');
    await waitFor(() => expect(outcome.textContent).toMatch(/^rejected:/));
  });

  it('marks its infrastructure snapshot as simulated', async () => {
    stubApiOffline();
    renderWithProviders(<ClientProbe call={(client) => client.infrastructure()} />);

    const outcome = await screen.findByTestId('outcome');
    await waitFor(() => expect(outcome.textContent).toMatch(/^resolved:/));
    expect(outcome.textContent).toMatch(/"simulated":true/);
  });
});
