import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');

/**
 * End-to-end tests, with their own config and their own root.
 *
 * The root matters: Vitest discovers `vitest.workspace.ts` relative to the root
 * and, when it finds one, runs those projects instead of the supplied config.
 * Rooting this config in its own directory is what keeps `make e2e` from
 * quietly running the unit suite instead.
 *
 * These tests need a running stack — PostgreSQL, Kafka, RabbitMQ and all four
 * services — so they must never be part of `pnpm test`, where a failure would
 * mean "docker is not running" rather than "the code is wrong".
 */
export default defineConfig({
  root: here,
  resolve: {
    alias: {
      '@oat/shared': path.resolve(repo, 'packages/shared/src/index.ts'),
    },
  },
  test: {
    name: 'e2e',
    include: ['**/*.test.ts'],
    environment: 'node',
    // Kafka consumption, a five-second retry delay and three attempts: this
    // suite is legitimately slow, and a short timeout would make it flaky.
    testTimeout: 90_000,
    hookTimeout: 100_000,
    // Sequential and single-forked: the tests share one database and several
    // assert on fleet-wide counters.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
