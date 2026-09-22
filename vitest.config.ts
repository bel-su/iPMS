import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Vitest 4 no longer reads `vitest.workspace.*`, and `test.workspace` was
    // removed outright — only `test.projects` defines a multi-project run. With
    // neither present, a root `vitest run` silently degrades to a single
    // default project rooted here, which ignores every per-project config
    // (apps/web's `server-only` alias, the Testcontainers setup files, the
    // `include` scoping) and sweeps the whole tree with the default
    // `**/*.{test,spec}.?(c|m)[jt]s?(x)` glob. Vitest 4 also dropped
    // `**/dist/**` from `defaultExclude`, so that sweep picks up compiled
    // `*.spec.js` under any stale build output as well.
    //
    // Declaring the projects here restores the intent: each one runs under its
    // own config, and because a projects list suppresses the default project,
    // nothing at the repository root is collected. `nx run-many -t test` is
    // unaffected — it invokes each project's `vitest run` directly and never
    // consults this file.
    //
    // `e2e/` is deliberately absent: it drives a running stack, is outside the
    // pnpm workspace, and has no nx `test` target.
    projects: ['libs/*/vitest.config.ts', 'apps/*/vitest.config.ts', 'apps/*/vitest.config.mts'],
  },
});
