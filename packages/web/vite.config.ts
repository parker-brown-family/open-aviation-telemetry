import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Resolve the shared contracts to source. The web client and the services
      // then share one definition of the telemetry schema, the topic names and
      // the alert thresholds — the Architecture Explorer displays the same
      // constants the stream processor actually uses.
      '@oat/shared': path.resolve(here, '../shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    // In development the client talks to the API through this proxy, so the
    // browser only ever sees one origin and CORS never enters the picture.
    // In a deployed environment the API base URL is configured explicitly.
    proxy: {
      '/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:8080', changeOrigin: true },
      '/docs': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
