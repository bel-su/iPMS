import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['app/**/*.spec.ts'],
  },
  resolve: {
    alias: {
      // Next aliases this marker package internally; outside a Next build it
      // does not resolve, so the server-only modules get a no-op stand-in.
      'server-only': fileURLToPath(new URL('./test/server-only.stub.ts', import.meta.url)),
    },
  },
});
