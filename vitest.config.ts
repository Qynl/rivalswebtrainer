import { defineConfig } from 'vitest/config';

// The end-to-end client test boots a real server and a real socket, so it is
// measured in seconds, not milliseconds. The physics tests still pin the
// simulation at a fixed 1/60 s step; only the harness clock is generous.
export default defineConfig({
  test: {
    testTimeout: 90000,
    hookTimeout: 90000,
  },
});
