import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { App } from './App.js';
import { renderWithProviders, stubApiOffline } from './test-utils.js';

/**
 * Routing.
 *
 * The interesting assertion is the last one. This client is published as plain
 * files under a subdirectory of an existing site, with no rewrite rule on the
 * web server — deep links work only because the build script materialises each
 * client-side route as its own directory. That means the route list in
 * scripts/build-static.sh has to stay in step with the routes declared here,
 * and nothing in the type system connects the two. Add a route, forget the
 * script, and the page works perfectly in development and 404s in production
 * for anyone who follows a link to it.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

/**
 * Both lists are read from source rather than restated here.
 *
 * This file used to keep its own copy of the routes, which made three places to
 * update instead of two — and the first time a route was added it was the
 * test's copy that went stale, not the code. A guard that needs maintaining
 * every time the thing it guards changes is a guard people eventually delete.
 */
function declaredRoutes(): string[] {
  const source = readFileSync(path.join(here, 'App.tsx'), 'utf8');
  return [...source.matchAll(/<Route\s+path="([^"]+)"/g)]
    .map((m) => m[1]!)
    .filter((p) => p !== '/' && p !== '*')
    .map((p) => p.replace(/^\//, ''))
    .sort();
}

function prerenderedRoutes(): string[] {
  const script = readFileSync(path.join(repoRoot, 'scripts/build-static.sh'), 'utf8');
  const declared = /^ROUTES=\(([^)]*)\)/m.exec(script);
  if (!declared) throw new Error('ROUTES not found in scripts/build-static.sh');
  return declared[1]!.trim().split(/\s+/).sort();
}

beforeEach(() => {
  stubApiOffline();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('routes', () => {
  it('shows the dashboard at the root', async () => {
    renderWithProviders(<App />, { route: '/' });
    expect(await screen.findByRole('heading', { name: 'Fleet dashboard' })).toBeInTheDocument();
  });

  it.each([
    ['/fleet', 'Fleet'],
    ['/alerts', 'Alerts and reports'],
    ['/architecture', 'Architecture explorer'],
    ['/demo', 'Demo console'],
  ])('renders %s', async (route, heading) => {
    renderWithProviders(<App />, { route });
    expect(await screen.findByRole('heading', { name: heading, level: 1 })).toBeInTheDocument();
  });

  it('renders the research page', async () => {
    renderWithProviders(<App />, { route: '/research' });
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('sends an unknown path to the dashboard rather than a blank screen', async () => {
    renderWithProviders(<App />, { route: '/no-such-page' });
    expect(await screen.findByRole('heading', { name: 'Fleet dashboard' })).toBeInTheDocument();
  });

  it('keeps the query string when a route carries one', async () => {
    renderWithProviders(<App />, { route: '/fleet?aircraft=C-GABC' });
    expect(await screen.findByRole('heading', { name: 'Fleet', level: 1 })).toBeInTheDocument();
  });
});

describe('the published build', () => {
  it('materialises a directory for every client-side route', () => {
    // Without this, a deep link to /architecture is a request for a file the
    // static host does not have: it works in dev and 404s in production.
    const missing = declaredRoutes().filter((r) => !prerenderedRoutes().includes(r));
    expect(missing, `not pre-rendered by build-static.sh: ${missing.join(', ')}`).toEqual([]);
  });

  it('does not pre-render a route the application no longer serves', () => {
    // The other direction: a stale entry silently ships an empty directory.
    const orphaned = prerenderedRoutes().filter((r) => !declaredRoutes().includes(r));
    expect(orphaned, `pre-rendered but not served: ${orphaned.join(', ')}`).toEqual([]);
  });

  it('finds routes to check at all', () => {
    // Guards the guard. Both lists are parsed out of source, so a regex that
    // stops matching would leave the two tests above comparing empty arrays and
    // passing while the coupling they exist to protect went unchecked.
    expect(declaredRoutes().length).toBeGreaterThan(3);
    expect(prerenderedRoutes().length).toBeGreaterThan(3);
  });
});
