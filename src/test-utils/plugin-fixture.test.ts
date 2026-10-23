/** The plugin fixture deletes every temp dir it made. */
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanupPluginFixtures, fixtureDir, fixtureKey, pluginFixture } from "./plugin-fixture.js";

describe("plugin fixture cleanup", () => {
  it("cleanupPluginFixtures deletes the key, source, and scratch dirs it made", () => {
    const key = fixtureKey("cleanup");
    const source = pluginFixture({ schema: 1, name: "acme", version: "1.0.0" }, key).dir;
    const scratch = fixtureDir("plugin-scratch-");

    cleanupPluginFixtures();

    for (const dir of [dirname(key.file), source, scratch]) expect(existsSync(dir)).toBe(false);
    expect(existsSync(fixtureKey("after-cleanup").file)).toBe(true);
  });
});
