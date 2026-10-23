import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { INSTALLED_SKILLS_DIR } from "../paths.js";
import { expandHome } from "../utils.js";
import { findSkillDirInCache } from "./index-source.js";
import {
  copySkillFromCache,
  isAlreadyInstalled,
  isInstalledSkillCurrent,
  resetSourceFallbackAnnounced,
} from "./install-skill.js";

// install-skill.ts resolves the installed-skills dir at import time, so the
// tmpdir home path must be set before vi.mock runs (AGENTS.md rule #15). Without it,
// copySkillFromCache deletes and rewrites the real installed skill.
const mockHome = vi.hoisted(() => {
  const os = require("node:os") as typeof import("node:os");
  const path = require("node:path") as typeof import("node:path");
  return path.join(os.tmpdir(), `agentbrew-install-skill-home-${process.pid}-${Date.now()}`);
});

vi.mock("../utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils.js")>()),
  expandHome: (path: string) => path.replace(/^~/, mockHome),
}));

beforeAll(() => {
  mkdirSync(mockHome, { recursive: true });
});

afterAll(() => {
  rmSync(mockHome, { recursive: true, force: true });
});

describe("copySkillFromCache", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `agentbrew-test-skill-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns undefined when cache path doesn't exist", () => {
    const result = copySkillFromCache(join(testDir, "nonexistent"), "test-skill");
    expect(result).toBeUndefined();
  });

  it("returns undefined when no SKILL.md in cache", () => {
    const cachePath = join(testDir, "empty-skill");
    mkdirSync(cachePath, { recursive: true });
    const result = copySkillFromCache(cachePath, "test-skill");
    expect(result).toBeUndefined();
  });

  it("finds skills nested under plugins/*/skills/<name>/ (anthropics layout)", () => {
    const cachePath = join(testDir, "anthropics-cache");
    const skillDir = join(cachePath, "plugins", "mcp-server-dev", "skills", "build-mcp-server");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: build-mcp-server\n---\n");

    expect(findSkillDirInCache(cachePath, "build-mcp-server")).toBe(skillDir);

    const installedRoot = expandHome(INSTALLED_SKILLS_DIR);
    const destination = join(installedRoot, "build-mcp-server");
    // Guard: this test deletes `destination`, so it must never be the real one.
    expect(destination.startsWith(join(homedir(), ".config", "agentbrew"))).toBe(false);
    rmSync(destination, { recursive: true, force: true });

    const copied = copySkillFromCache(cachePath, "build-mcp-server");
    expect(copied).toBe(destination);
    rmSync(destination, { recursive: true, force: true });
  });
});

describe("isInstalledSkillCurrent", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `agentbrew-test-current-${process.pid}-${Date.now()}`);
    mkdirSync(join(testDir, "cache", "current-skill", "dist"), { recursive: true });
    writeFileSync(join(testDir, "cache", "current-skill", "SKILL.md"), "---\nname: current-skill\n---\n");
    writeFileSync(join(testDir, "cache", "current-skill", "dist", "tool.js"), "v1");
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    rmSync(join(expandHome(INSTALLED_SKILLS_DIR), "current-skill"), { recursive: true, force: true });
  });

  it("is true only while the installed copy matches the cache file for file", () => {
    const cachePath = join(testDir, "cache");
    expect(isInstalledSkillCurrent(cachePath, "current-skill")).toBe(false);

    copySkillFromCache(cachePath, "current-skill");
    expect(isInstalledSkillCurrent(cachePath, "current-skill")).toBe(true);

    writeFileSync(join(cachePath, "current-skill", "dist", "tool.js"), "v2");
    expect(isInstalledSkillCurrent(cachePath, "current-skill")).toBe(false);

    copySkillFromCache(cachePath, "current-skill");
    writeFileSync(join(cachePath, "current-skill", "extra.md"), "new file");
    expect(isInstalledSkillCurrent(cachePath, "current-skill")).toBe(false);
  });

  it("is false when the cache has no such skill", () => {
    expect(isInstalledSkillCurrent(join(testDir, "cache"), "missing-skill")).toBe(false);
  });
});

describe("isAlreadyInstalled", () => {
  it("returns false for a non-existent skill", () => {
    const skill = {
      name: `nonexistent-skill-xyz-${Date.now()}`,
      description: "test",
      source: "test/repo",
    };
    expect(isAlreadyInstalled(skill as never)).toBe(false);
  });
});

describe("resetSourceFallbackAnnounced", () => {
  it("does not throw", () => {
    expect(() => resetSourceFallbackAnnounced()).not.toThrow();
  });
});
