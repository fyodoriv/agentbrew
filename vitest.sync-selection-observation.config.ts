import { configDefaults, defineConfig } from "vitest/config";
import base from "./vitest.config.js";

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["src/sync-selection-observation.prep.test.ts"],
    exclude: configDefaults.exclude,
  },
});
