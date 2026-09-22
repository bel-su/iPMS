import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'prisma/**/*.spec.ts'],
    // Resolves DOCKER_HOST for Testcontainers on a fresh clone and in CI.
    setupFiles: ['../../tools/vitest-setup-containers.ts'],
  },
});
