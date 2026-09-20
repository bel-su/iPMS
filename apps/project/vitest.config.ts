import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'prisma/**/*.spec.ts'],
    // Resolves DOCKER_HOST for Testcontainers so integration tests run on a
    // fresh clone and in CI without anyone exporting env vars by hand.
    setupFiles: ['../../tools/vitest-setup-containers.ts'],
  },
});
