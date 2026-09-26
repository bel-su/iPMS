import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    // Every spec drives the same live stack and the same four demo accounts, so
    // one file's grant to `engineer` is visible to another file asserting that
    // `engineer` sees nothing. Run the files one at a time.
    fileParallelism: false,
  },
});
