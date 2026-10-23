/** The plugin fixture deletes every temp dir it made, even when a test fails. */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanupPluginFixtures, fixtureDir, fixtureKey, pluginFixture } from "./plugin-fixture.js";

const VITEST = resolve(import.meta.dirname, "../../node_modules/.bin/vitest");

describe("plugin fixture cleanup", () => {
  it("cleanupPluginFixtures deletes the key, source, and scratch dirs it made", () => {
    const key = fixtureKey("cleanup");
    const source = pluginFixture({ schema: 1, name: "acme", version: "1.0.0" }, key).dir;
    const scratch = fixtureDir("plugin-scratch-");

    cleanupPluginFixtures();

    for (const dir of [dirname(key.file), source, scratch]) expect(existsSync(dir)).toBe(false);
    expect(existsSync(fixtureKey("after-cleanup").file)).toBe(true);
  });

  it("importing the fixture deletes its dirs after a test file whose test fails", () => {
    const root = fixtureDir("plugin-hook-root-");
    const made = join(root, "made.json");
    const fixture = resolve(import.meta.dirname, "plugin-fixture.ts");
    writeFileSync(
      join(root, "leak.test.ts"),
      [
        `import { writeFileSync } from "node:fs";`,
        `import { dirname } from "node:path";`,
        `import { expect, it } from "vitest";`,
        `import { fixtureDir, fixtureKey, pluginFixture } from ${JSON.stringify(fixture)};`,
        `it("fails on purpose", () => {`,
        `  const key = fixtureKey();`,
        `  const dirs = [dirname(key.file), pluginFixture({ schema: 1, name: "a", version: "1.0.0" }, key).dir, fixtureDir("plugin-x-")];`,
        `  writeFileSync(${JSON.stringify(made)}, JSON.stringify(dirs));`,
        `  expect("cleanup").toBe("skipped");`,
        `});`,
      ].join("\n"),
    );
    // Its own config, so vitest never picks up one from a folder above tmpdir().
    writeFileSync(join(root, "vitest.config.mjs"), "export default {};\n");
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("VITEST")));

    const run = spawnSync(VITEST, ["run"], { cwd: root, env, encoding: "utf-8", timeout: 25_000 });

    expect(run.status, `${run.stdout}${run.stderr}`).toBe(1);
    expect(run.stdout).toContain("fails on purpose");
    const dirs = JSON.parse(readFileSync(made, "utf-8")) as string[];
    expect(dirs).toHaveLength(3);
    for (const dir of dirs) expect(existsSync(dir)).toBe(false);
  });
});
