import { mkdirSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Checks vitest.isolated-home.ts: tests never see the developer's real HOME.
const realHome = userInfo().homedir;

describe("test isolation", () => {
  it("gives every test file a scratch HOME", () => {
    expect(homedir()).not.toBe(realHome);
    expect(process.env.HOME).toBe(homedir());
  });

  it("scrubs env that changes agentbrew or gate behaviour", () => {
    expect(process.env.NO_CACHE).toBeUndefined();
    expect(
      Object.keys(process.env).filter((key) => key.startsWith("AGENTBREW_") && key !== "AGENTBREW_EVENTS"),
    ).toEqual([]);
  });

  it("refuses writes to the real ~/.config/agentbrew and ~/.claude", async () => {
    const real = join(realHome, ".config", "agentbrew", "test-isolation-should-not-exist");
    expect(() => writeFileSync(real, "x")).toThrow(/Test wrote the real/);
    expect(() => mkdirSync(join(realHome, ".claude", "test-isolation-should-not-exist"))).toThrow(
      /Test wrote the real/,
    );
    await expect(writeFile(join(realHome, ".claude.json"), "{}")).rejects.toThrow(/Test wrote the real/);
  });

  it("still allows writes under the scratch HOME", () => {
    mkdirSync(join(homedir(), ".claude"), { recursive: true });
    expect(() => writeFileSync(join(homedir(), ".claude", "settings.json"), "{}")).not.toThrow();
  });
});
