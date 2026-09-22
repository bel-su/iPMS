import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['app/**/*.spec.ts', 'app/**/*.spec.tsx'],
  },
  /**
   * `tsconfig.json` sets `jsx: "preserve"`, which is what Next wants — it does
   * its own JSX transform. Vitest does not, so without this a `.spec.tsx` fails
   * to parse before a single test runs. `automatic` needs no React import in
   * the file under test, matching how the components are written.
   */
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: {
      // Next aliases this marker package internally; outside a Next build it
      // does not resolve, so the server-only modules get a no-op stand-in.
      'server-only': fileURLToPath(new URL('./test/server-only.stub.ts', import.meta.url)),
    },
  },
});
