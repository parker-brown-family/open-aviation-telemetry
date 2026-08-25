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
      reporter: ['text', 'lcov'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/**/*.test.ts', 'packages/web/**'],
    },
  },
});
