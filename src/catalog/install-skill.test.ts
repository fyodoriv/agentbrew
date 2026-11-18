import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getStateSources } from "../agentfile.js";
import { INSTALLED_SKILLS_DIR } from "../paths.js";
import { loadState, saveState } from "../state.js";
import { expandHome } from "../utils.js";
import { findSkillDirInCache, getSourceCachePath } from "./index-source.js";
import {
  copySkillFromCache,
  installSkill,
  isAlreadyInstalled,
  isInstalledSkillCurrent,
  resetSourceFallbackAnnounced,
} from "./install-skill.js";

import type { CatalogSkill } from "./types.js";

vi.mock("./index-source.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./index-source.js")>()),
  getSourceCachePath: vi.fn(),
}));

vi.mock("../state.js", () => ({
  loadState: vi.fn(),
  saveState: vi.fn(),
}));

vi.mock("../lock.js", () => ({ lockSource: vi.fn() }));
vi.mock("../skills/skill-versions.js", () => ({ recordSourceSha: vi.fn() }));

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

describe("owner-preserving named catalog installs", () => {
  const skill: CatalogSkill = {
    name: "protected-web-guide",
    description: "Test catalog guide",
    source: "public/example",
    category: "development",
    recommended: false,
    preserveExisting: true,
  };
  let fixture: string;
  let staged: string;
  let project: string;
  let local: string;

  beforeEach(() => {
    fixture = mkdtempSync(join(tmpdir(), "agentbrew-protected-install-"));
    const cached = join(fixture, "cache", "skills", skill.name);
    mkdirSync(cached, { recursive: true });
    writeFileSync(join(cached, "SKILL.md"), "# Catalog guide");
    staged = join(expandHome(INSTALLED_SKILLS_DIR), skill.name);
    project = join(fixture, "project");
    local = join(project, ".agentbrew", "skills", skill.name);
    vi.mocked(getSourceCachePath).mockReturnValue(join(fixture, "cache"));
    vi.mocked(loadState).mockReturnValue({ agents: [], mcpServers: [], catalogVersion: "0.1.0" });
  });

  afterEach(() => {
    rmSync(fixture, { recursive: true, force: true });
    rmSync(staged, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  function installAt(scope: string) {
    return installSkill(
      skill,
      { alreadyInstalled: [], failedSourceSkips: new Map() },
      scope === "project" ? project : undefined,
    );
  }

  it.each(["staging", "project"])("keeps an existing %s skill and its registration untouched", async (scope) => {
    const dest = scope === "staging" ? staged : local;
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "SKILL.md"), "# Owner guide");
    await installAt(scope);
    expect(readFileSync(join(dest, "SKILL.md"), "utf-8")).toBe("# Owner guide");
    expect(saveState).not.toHaveBeenCalled();
    expect(existsSync(join(project, "Agentfile.yaml"))).toBe(false);
  });

  it.each(["staging", "project"])("keeps a dangling %s skill link at its original target", async (scope) => {
    const dest = scope === "staging" ? staged : local;
    const absent = join(fixture, "absent");
    mkdirSync(join(dest, ".."), { recursive: true });
    symlinkSync(absent, dest, "dir");
    await installAt(scope);
    expect(readlinkSync(dest)).toBe(absent);
    expect(existsSync(absent)).toBe(false);
    expect(saveState).not.toHaveBeenCalled();
    expect(existsSync(join(project, "Agentfile.yaml"))).toBe(false);
  });

  it.each(["staging", "project"])("installs and registers a fresh %s skill", async (scope) => {
    const dest = scope === "staging" ? staged : local;
    await installAt(scope);
    expect(readFileSync(join(dest, "SKILL.md"), "utf-8")).toBe("# Catalog guide");
    if (scope === "staging") {
      expect(getStateSources(vi.mocked(loadState).mock.results[0].value)[0]?.skillsInstalled).toEqual([skill.name]);
      expect(saveState).toHaveBeenCalledOnce();
    } else {
      expect(readFileSync(join(project, "Agentfile.yaml"), "utf-8")).toContain(skill.name);
      expect(saveState).not.toHaveBeenCalled();
    }
  });
});
