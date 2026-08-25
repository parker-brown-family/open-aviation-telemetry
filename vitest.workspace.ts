/**
 * Two test projects, because they need different environments.
 *
 *   services — pure Node. Contracts, stream-processing rules, report arithmetic.
 *              Fast, no I/O, no browser.
 *   web      — jsdom. Component behaviour, and in particular the data-source
 *              honesty layer, which is the thing most worth having a test for:
 *              a regression there would mean the published page could show
 *              sample numbers without saying so.
 *
 * End-to-end tests live in tests/e2e and are a separate concern — they need a
 * running stack, so they are not part of the default `pnpm test`.
 */
export default [
  {
    extends: './vitest.config.ts',
    test: {
      name: 'services',
      environment: 'node',
      include: ['packages/*/src/**/*.test.ts'],
      // The web package has its own project below, with a DOM environment.
      // Excluding it here rather than listing every service keeps a newly added
      // service in the suite by default instead of silently untested.
      exclude: ['packages/web/**'],
    },
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'web',
      environment: 'jsdom',
      setupFiles: ['./packages/web/vitest.setup.ts'],
      include: ['packages/web/src/**/*.test.{ts,tsx}'],
    },
  },
];
