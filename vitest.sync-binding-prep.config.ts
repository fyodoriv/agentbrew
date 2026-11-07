import { join } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";
import base from "./vitest.config.js";

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    cacheDir: join(process.env.TMPDIR ?? "/tmp", "sync-binding-vitest-cache"),
    experimental: { ...base.test?.experimental, fsModuleCachePath: join(process.env.TMPDIR ?? "/tmp", "sync-binding-module-cache") },
    include: ["src/sync-selection-binding.prep.test.ts"],
    exclude: configDefaults.exclude,
  },
});
