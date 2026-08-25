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

/** Every path App declares, minus "/" and the catch-all. */
const ROUTES = ['fleet', 'alerts', 'architecture', 'research', 'training', 'demo'];

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
  const script = readFileSync(path.join(repoRoot, 'scripts/build-static.sh'), 'utf8');

  it('materialises a directory for every client-side route', () => {
    // Without this, a deep link to /architecture is a request for a file the
    // static host does not have. It works in dev and 404s in production.
    const declared = /^ROUTES=\(([^)]*)\)/m.exec(script);
    expect(declared, 'ROUTES not found in build-static.sh').not.toBeNull();

    const listed = declared![1]!.trim().split(/\s+/);
    for (const route of ROUTES) {
      expect(listed, `/${route} is not pre-rendered by build-static.sh`).toContain(route);
    }
  });

  it('does not pre-render a route the application no longer serves', () => {
    const listed = /^ROUTES=\(([^)]*)\)/m.exec(script)![1]!.trim().split(/\s+/);
    for (const route of listed) {
      expect(ROUTES, `build-static.sh pre-renders /${route}, which App does not serve`).toContain(
        route,
      );
    }
  });

  it('lists every route the App component declares', () => {
    // Guards the guard: if a Route is added to App.tsx and not to ROUTES above,
    // the two tests before this one would keep passing while the new route goes
    // unbuilt.
    const source = readFileSync(path.join(here, 'App.tsx'), 'utf8');
    const paths = [...source.matchAll(/<Route\s+path="([^"]+)"/g)]
      .map((m) => m[1]!)
      .filter((p) => p !== '/' && p !== '*')
      .map((p) => p.replace(/^\//, ''));

    expect(paths.sort()).toEqual([...ROUTES].sort());
  });
});
