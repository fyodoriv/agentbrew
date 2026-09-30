import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    cacheDir: "node_modules/.cache/vitest-real-e2e",
    fileParallelism: false,
    include: ["real-e2e/**/*.test.ts"],
    maxWorkers: 1,
    minWorkers: 1,
    passWithNoTests: false,
    testTimeout: 30_000,
  },
});
