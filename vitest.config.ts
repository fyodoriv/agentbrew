import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    cacheDir: "node_modules/.cache/vitest",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    experimental: {
      fsModuleCache: true,
    },
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/cli.ts"],
    },
  },
});
