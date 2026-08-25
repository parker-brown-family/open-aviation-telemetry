import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = (name: string): string => path.resolve(here, 'packages', name, 'src/index.ts');

export default defineConfig({
  // Resolve workspace packages to their TypeScript source rather than to dist.
  // Without this, `pnpm test` would only work after `pnpm build`, and a stale
  // dist would let tests pass against code that is no longer in the repository.
  resolve: {
    alias: {
      '@oat/shared': pkg('shared'),
      '@oat/data': pkg('data'),
      '@oat/service-kit': pkg('service-kit'),
    },
  },
  test: {
    // No `include` here on purpose. Workspace projects inherit this config, and
    // an include declared at this level merges into every project rather than
    // being replaced by it — which made both projects run every test file.
    // Each project in vitest.workspace.ts owns its own include.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: [
        'packages/*/src/**/*.test.{ts,tsx}',
        'packages/web/src/test-utils.tsx',
        // Process entrypoints are wiring: connect to a broker, start a server,
        // register shutdown handlers. They are exercised by the end-to-end
        // suite, which runs against a real stack and reports no coverage.
        // Counting them here would make the number describe how much of the
        // codebase is *startup code* rather than how well the logic is tested.
        'packages/*/src/main.ts',
        'packages/telemetry-api/src/migrate.ts',
      ],
    },
  },
});
