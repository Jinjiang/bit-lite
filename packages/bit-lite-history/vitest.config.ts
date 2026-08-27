import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Every integration test in this package drives real Git subprocesses
    // against real repositories. One test can spawn dozens of processes, which
    // exceeds the 5s default when the workspace suite runs packages in
    // parallel.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
