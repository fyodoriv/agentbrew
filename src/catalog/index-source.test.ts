import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));

vi.mock("../utils.js", () => ({
  checkGitAvailable: vi.fn(() => true),
}));

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { Source } from "../types.js";
import {
  classifyGitError,
  formatItemCounts,
  getSourceCachePath,
  indexAllSources,
  indexSource,
  isSourceFailed,
  parseFrontmatter,
  readSourceManifest,
  resetSessionCache,
  scanDirectoryForSkills,
} from "./index-source.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockExecSync = vi.mocked(execSync);
const mockExecFileSync = vi.mocked(execFileSync);

beforeEach(() => {
  vi.clearAllMocks();
  resetSessionCache();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("parseFrontmatter", () => {
  it("extracts name and description from simple frontmatter", () => {
    const content = `---
name: my-skill
description: A useful skill
---

## Content`;
    const result = parseFrontmatter(content);
    expect(result.name).toBe("my-skill");
    expect(result.description).toBe("A useful skill");
  });

  it("handles multiline description with >", () => {
    const content = `---
name: test-skill
description: >
  This is a multiline
  description that wraps
---

## Body`;
    const result = parseFrontmatter(content);
    expect(result.name).toBe("test-skill");
    expect(result.description).toBe("This is a multiline description that wraps");
  });

  it("handles quoted values", () => {
    const content = `---
name: "quoted-skill"
description: "A quoted description"
---`;
    const result = parseFrontmatter(content);
    expect(result.name).toBe("quoted-skill");
    expect(result.description).toBe("A quoted description");
  });

  it("returns empty object when no frontmatter", () => {
    const result = parseFrontmatter("# Just markdown\n\nNo frontmatter here.");
    expect(result).toEqual({});
  });

  it("returns partial result when only name present", () => {
    const content = `---
name: partial
---`;
    const result = parseFrontmatter(content);
    expect(result.name).toBe("partial");
    expect(result.description).toBeUndefined();
  });
});

describe("scanDirectoryForSkills", () => {
  it("returns empty array for nonexistent directory", () => {
    mockExistsSync.mockReturnValue(false);
    expect(scanDirectoryForSkills("/nonexistent")).toEqual([]);
  });

  it("scans subdirectories for SKILL.md files", () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path === "/repo" || path.endsWith("SKILL.md");
    });

    mockReaddirSync.mockReturnValue([
      { name: "skill-a", isDirectory: () => true, isFile: () => false },
      { name: "skill-b", isDirectory: () => true, isFile: () => false },
      { name: "README.md", isDirectory: () => false, isFile: () => true },
    ] as never);

    mockReadFileSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("skill-a")) {
        return "---\nname: skill-a\ndescription: First skill\n---\n# Content";
      }
      return "---\nname: skill-b\ndescription: Second skill\n---\n# Content";
    });

    const items = scanDirectoryForSkills("/repo");
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe("skill-a");
    expect(items[0].description).toBe("First skill");
    expect(items[1].name).toBe("skill-b");
    expect(items[1].description).toBe("Second skill");
  });

  it("uses directory name as fallback when SKILL.md parse fails", () => {
    mockExistsSync.mockReturnValue(true);

    mockReaddirSync.mockReturnValue([{ name: "broken-skill", isDirectory: () => true, isFile: () => false }] as never);

    mockReadFileSync.mockImplementation(() => {
      throw new Error("read error");
    });

    const items = scanDirectoryForSkills("/repo");
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("broken-skill");
    expect(items[0].description).toBe("");
  });

  it("skips hidden directories", () => {
    mockExistsSync.mockReturnValue(true);

    mockReaddirSync.mockReturnValue([
      { name: ".git", isDirectory: () => true, isFile: () => false },
      { name: "real-skill", isDirectory: () => true, isFile: () => false },
    ] as never);

    mockReadFileSync.mockReturnValue("---\nname: real-skill\ndescription: ok\n---");

    const items = scanDirectoryForSkills("/repo");
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("real-skill");
  });

  it("falls back to root SKILL.md for single-skill repos when no subdirectories found", () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      // The repo dir exists, skills/ subdir does not, but SKILL.md at root does
      return path === "/repo" || path === "/repo/SKILL.md";
    });

    mockReaddirSync.mockReturnValue([] as never);

    mockReadFileSync.mockReturnValue(
      "---\nname: playwright-best-practices\ndescription: Comprehensive Playwright guide\n---\n# Content",
    );

    const items = scanDirectoryForSkills("/repo");
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("playwright-best-practices");
    expect(items[0].description).toBe("Comprehensive Playwright guide");
    expect(items[0].type).toBe("skill");
  });

  it("discovers skills from DESIGN.md when SKILL.md is absent", () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path === "/repo") return true;
      if (path.endsWith("SKILL.md")) return false;
      if (path.endsWith("DESIGN.md")) return true;
      return false;
    });

    mockReaddirSync.mockReturnValue([{ name: "linear", isDirectory: () => true, isFile: () => false }] as never);

    mockReadFileSync.mockReturnValue(
      "---\nname: design-linear\ndescription: Linear design system reference\n---\n# Linear Design",
    );

    const items = scanDirectoryForSkills("/repo");
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("design-linear");
    expect(items[0].description).toBe("Linear design system reference");
    expect(items[0].type).toBe("skill");
  });

  it("prefers SKILL.md over DESIGN.md when both exist", () => {
    mockExistsSync.mockReturnValue(true);

    mockReaddirSync.mockReturnValue([{ name: "my-tool", isDirectory: () => true, isFile: () => false }] as never);

    mockReadFileSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("SKILL.md")) return "---\nname: from-skill\ndescription: From SKILL.md\n---";
      return "---\nname: from-design\ndescription: From DESIGN.md\n---";
    });

    const items = scanDirectoryForSkills("/repo");
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("from-skill");
  });

  it("falls back to root DESIGN.md for single-skill repos when no SKILL.md exists", () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path === "/repo") return true;
      if (path === "/repo/DESIGN.md") return true;
      return false;
    });

    mockReaddirSync.mockReturnValue([] as never);

    mockReadFileSync.mockReturnValue("---\nname: stripe-design\ndescription: Stripe design system\n---\n# Stripe");

    const items = scanDirectoryForSkills("/repo");
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("stripe-design");
    expect(items[0].description).toBe("Stripe design system");
  });

  it("discovers skills from lowercase skill.md when SKILL.md is absent", () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path === "/repo") return true;
      if (path.endsWith("my-skill/SKILL.md")) return false;
      if (path.endsWith("my-skill/skill.md")) return true;
      if (path.endsWith("my-skill/DESIGN.md")) return false;
      return false;
    });

    mockReaddirSync.mockReturnValue([{ name: "my-skill", isDirectory: () => true, isFile: () => false }] as never);

    mockReadFileSync.mockReturnValue("---\nname: lowercase-skill\ndescription: From lowercase skill.md\n---");

    const items = scanDirectoryForSkills("/repo");
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("lowercase-skill");
    expect(items[0].description).toBe("From lowercase skill.md");
  });

  it("discovers skills via deep scan when root and skills/ have no results", () => {
    // Root exists, no direct skill subdirs with SKILL.md/DESIGN.md, no root SKILL.md —
    // but a nested dir like src/scaffold/skills/my-deep-skill/SKILL.md exists
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path === "/repo") return true;
      if (path.endsWith("src/scaffold/skills/my-deep-skill/SKILL.md")) return true;
      return false;
    });

    mockReaddirSync.mockImplementation((p) => {
      const path = String(p);
      if (path === "/repo") {
        return [{ name: "src", isDirectory: () => true, isFile: () => false }] as never;
      }
      if (path.endsWith("src")) {
        return [{ name: "scaffold", isDirectory: () => true, isFile: () => false }] as never;
      }
      if (path.endsWith("scaffold")) {
        return [{ name: "skills", isDirectory: () => true, isFile: () => false }] as never;
      }
      if (path.endsWith("skills")) {
        return [{ name: "my-deep-skill", isDirectory: () => true, isFile: () => false }] as never;
      }
      return [] as never;
    });

    mockReadFileSync.mockReturnValue("---\nname: my-deep-skill\ndescription: Found deeply\n---");

    const items = scanDirectoryForSkills("/repo");
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("my-deep-skill");
    expect(items[0].description).toBe("Found deeply");
  });
});

describe("readSourceManifest", () => {
  it("reads a scalar bootstrap script from agentbrew-source.yaml", () => {
    mockExistsSync.mockImplementation((path) => String(path) === "/repo/agentbrew-source.yaml");
    mockReadFileSync.mockReturnValue("bootstrap: /path/to/script.sh\n");

    expect(readSourceManifest("/repo")).toEqual({ bootstrapScript: "/path/to/script.sh" });
  });

  it("reads a bootstrap script block from source.yaml", () => {
    mockExistsSync.mockImplementation((path) => String(path) === "/repo/source.yaml");
    mockReadFileSync.mockReturnValue("bootstrap:\n  script: scripts/bootstrap.sh\n");

    expect(readSourceManifest("/repo")).toEqual({ bootstrapScript: "scripts/bootstrap.sh" });
  });
});

describe("indexSource", () => {
  it("scans local path directly", () => {
    const source: Source = {
      url: "/tmp/my-skills",
      type: "local",
      skillsInstalled: [],
      availableItems: [],
      addedAt: "2026-01-01",
    };

    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path === "/tmp/my-skills" || path.endsWith("SKILL.md");
    });

    mockReaddirSync.mockReturnValue([{ name: "cool-skill", isDirectory: () => true, isFile: () => false }] as never);

    mockReadFileSync.mockReturnValue("---\nname: cool-skill\ndescription: Cool\n---");

    const items = indexSource(source);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("cool-skill");
  });

  it("clones github source then scans", () => {
    const source: Source = {
      url: "user/repo",
      type: "github",
      skillsInstalled: [],
      availableItems: [],
      addedAt: "2026-01-01",
    };

    // .git dir doesn't exist yet (fresh clone)
    let cloned = false;
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes(".git")) return false;
      if (path.includes(".cache") && !cloned) return false;
      // After clone: the cache dir itself exists, but no SKILL.md/DESIGN.md at root and no skill subdirs
      if (cloned && path.includes(".cache") && !path.endsWith("SKILL.md") && !path.endsWith("DESIGN.md")) return true;
      return false;
    });

    mockExecFileSync.mockImplementation(() => {
      cloned = true;
      return "" as never;
    });

    mockReaddirSync.mockReturnValue([] as never);

    const items = indexSource(source);
    expect(mockExecFileSync).toHaveBeenCalled();
    // No items because readdirSync returns empty and no root SKILL.md
    expect(items).toEqual([]);
  });

  it("throws when clone fails", () => {
    const source: Source = {
      url: "bad/repo",
      type: "github",
      skillsInstalled: [],
      availableItems: [],
      addedAt: "2026-01-01",
    };

    mockExistsSync.mockReturnValue(false);
    mockExecFileSync.mockImplementation(() => {
      throw new Error("clone failed");
    });

    expect(() => indexSource(source)).toThrow("git clone failed for bad/repo: clone failed");
  });

  it("pulls when .git directory already exists", () => {
    const source: Source = {
      url: "user/repo",
      type: "github",
      skillsInstalled: [],
      availableItems: [],
      addedAt: "2026-01-01",
    };

    mockExistsSync.mockImplementation((p) => {
      const _path = String(p);
      // .git exists (already cloned), cache dir exists, SKILL.md exists
      return true;
    });
    mockExecSync.mockReturnValue("" as never);
    mockReaddirSync.mockReturnValue([{ name: "my-skill", isDirectory: () => true, isFile: () => false }] as never);
    mockReadFileSync.mockReturnValue("---\nname: my-skill\ndescription: Pulled\n---");

    const items = indexSource(source);
    // Should have called git pull (via execFileSync), not git clone
    expect(mockExecFileSync).toHaveBeenCalledWith("git", expect.arrayContaining(["pull"]), expect.anything());
    expect(items).toHaveLength(1);
  });

  it("returns cached data when git pull fails", () => {
    const source: Source = {
      url: "user/repo",
      type: "github",
      skillsInstalled: [],
      availableItems: [],
      addedAt: "2026-01-01",
    };

    mockExistsSync.mockReturnValue(true);
    mockExecFileSync.mockImplementation(() => {
      throw new Error("network error");
    });
    mockReaddirSync.mockReturnValue([{ name: "cached-skill", isDirectory: () => true, isFile: () => false }] as never);
    mockReadFileSync.mockReturnValue("---\nname: cached-skill\ndescription: From cache\n---");

    const items = indexSource(source);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("cached-skill");
  });

  it("logs a warning when git pull fails and stale cache is returned", () => {
    const source: Source = {
      url: "user/stale-repo",
      type: "github",
      skillsInstalled: [],
      availableItems: [],
      addedAt: "2026-01-01",
    };

    mockExistsSync.mockReturnValue(true);
    mockExecFileSync.mockImplementation(() => {
      throw new Error("network error");
    });
    mockReaddirSync.mockReturnValue([] as never);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    indexSource(source);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("user/stale-repo"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("cached"));
    warnSpy.mockRestore();
  });

  it("handles git type sources", () => {
    const source: Source = {
      url: "https://git.example.com/repo.git",
      type: "github",
      skillsInstalled: [],
      availableItems: [],
      addedAt: "2026-01-01",
    };

    mockExistsSync.mockReturnValue(false);
    mockExecFileSync.mockReturnValue("" as never);
    mockReaddirSync.mockReturnValue([] as never);

    indexSource(source);
    // Should use the URL as-is for git clone via execFileSync
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["clone", expect.stringContaining("git.example.com")]),
      expect.anything(),
    );
  });
});

describe("session cache", () => {
  const makeSource = (url = "user/repo"): Source => ({
    url,
    type: "github",
    skillsInstalled: [],
    availableItems: [],
    addedAt: "2026-01-01",
  });

  it("skips git pull on second call for the same source", () => {
    mockExistsSync.mockReturnValue(true);
    mockExecFileSync.mockReturnValue("" as never);
    mockReaddirSync.mockReturnValue([] as never);

    indexSource(makeSource());
    const pullCalls1 = mockExecFileSync.mock.calls.filter((c) => c[1]?.includes("pull")).length;
    expect(pullCalls1).toBe(1);

    mockExecFileSync.mockClear();
    indexSource(makeSource());
    const pullCalls2 = mockExecFileSync.mock.calls.filter((c) => c[1]?.includes("pull")).length;
    expect(pullCalls2).toBe(0);
  });

  it("still pulls for a different source URL", () => {
    mockExistsSync.mockReturnValue(true);
    mockExecFileSync.mockReturnValue("" as never);
    mockReaddirSync.mockReturnValue([] as never);

    indexSource(makeSource("org/repo-a"));
    mockExecFileSync.mockClear();

    indexSource(makeSource("org/repo-b"));
    const pullCalls = mockExecFileSync.mock.calls.filter((c) => c[1]?.includes("pull")).length;
    expect(pullCalls).toBe(1);
  });

  it("resetSessionCache allows re-pulling the same source", () => {
    mockExistsSync.mockReturnValue(true);
    mockExecFileSync.mockReturnValue("" as never);
    mockReaddirSync.mockReturnValue([] as never);

    indexSource(makeSource());
    resetSessionCache();
    mockExecFileSync.mockClear();

    indexSource(makeSource());
    const pullCalls = mockExecFileSync.mock.calls.filter((c) => c[1]?.includes("pull")).length;
    expect(pullCalls).toBe(1);
  });

  it("'Fetching' is logged once per source URL across multiple getSourceCachePath calls in one session", () => {
    // Regression guard for `sync-source-install-dedup-and-messaging`: installing N
    // skills from the same source must fetch (and log) the source only once.
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockExistsSync.mockReturnValue(true); // .git dir exists — pull path
    mockExecFileSync.mockReturnValue("" as never);

    const source = makeSource("trailofbits/skills");
    getSourceCachePath(source);
    getSourceCachePath(source);
    getSourceCachePath(source);
    getSourceCachePath(source);
    getSourceCachePath(source);

    const fetchLogs = logSpy.mock.calls.flat().filter((arg) => typeof arg === "string" && arg.includes("Fetching"));
    expect(fetchLogs).toHaveLength(1);
    expect(fetchLogs[0]).toContain("trailofbits/skills");
    logSpy.mockRestore();
  });

  it("'Fetching' logs again for the same URL after resetSessionCache", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockExistsSync.mockReturnValue(true);
    mockExecFileSync.mockReturnValue("" as never);

    const source = makeSource("owner/repo");
    getSourceCachePath(source);
    resetSessionCache();
    getSourceCachePath(source);

    const fetchLogs = logSpy.mock.calls.flat().filter((arg) => typeof arg === "string" && arg.includes("Fetching"));
    expect(fetchLogs).toHaveLength(2);
    logSpy.mockRestore();
  });

  it("'Fetching' logs on fresh clone, then stays quiet for subsequent calls in the same session", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    let cloned = false;
    mockExistsSync.mockImplementation(() => cloned);
    mockExecFileSync.mockImplementation(() => {
      cloned = true;
      return "" as never;
    });

    const source = makeSource("owner/fresh-repo");
    getSourceCachePath(source); // triggers fresh clone
    getSourceCachePath(source); // should hit session cache, no log
    getSourceCachePath(source); // should hit session cache, no log

    const fetchLogs = logSpy.mock.calls.flat().filter((arg) => typeof arg === "string" && arg.includes("Fetching"));
    expect(fetchLogs).toHaveLength(1);
    expect(fetchLogs[0]).toContain("owner/fresh-repo");
    logSpy.mockRestore();
  });

  it("caches after fresh clone too", () => {
    let cloned = false;
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes(".git")) return cloned;
      return cloned;
    });
    mockExecFileSync.mockImplementation(() => {
      cloned = true;
      return "" as never;
    });
    mockReaddirSync.mockReturnValue([] as never);

    indexSource(makeSource());
    const cloneCalls = mockExecFileSync.mock.calls.filter((c) => c[1]?.includes("clone")).length;
    expect(cloneCalls).toBe(1);

    mockExecFileSync.mockClear();
    indexSource(makeSource());
    // Should not clone or pull again
    const gitCalls = mockExecFileSync.mock.calls.filter(
      (c) => c[1]?.includes("clone") || c[1]?.includes("pull") || c[1]?.includes("fetch"),
    ).length;
    expect(gitCalls).toBe(0);
  });
});

describe("formatItemCounts", () => {
  it("formats single skill", () => {
    expect(formatItemCounts([{ name: "a", description: "", type: "skill" }])).toBe("1 skill");
  });

  it("formats multiple types", () => {
    const items = [
      { name: "a", description: "", type: "skill" as const },
      { name: "b", description: "", type: "skill" as const },
      { name: "c", description: "", type: "mcp" as const },
      { name: "d", description: "", type: "rule" as const },
      { name: "e", description: "", type: "command" as const },
      { name: "f", description: "", type: "command" as const },
    ];
    expect(formatItemCounts(items)).toBe("2 skills, 1 MCP server, 1 rule, 2 commands");
  });

  it("returns empty string for no items", () => {
    expect(formatItemCounts([])).toBe("");
  });
});

describe("multi-type indexing", () => {
  it("scans mcp-servers.yaml for MCP server items", () => {
    const source: Source = {
      url: "/tmp/team-config",
      type: "local",
      skillsInstalled: [],
      availableItems: [],
      addedAt: "2026-01-01",
    };

    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path === "/tmp/team-config" || path.endsWith("mcp-servers.yaml");
    });

    mockReaddirSync.mockReturnValue([] as never);

    mockReadFileSync.mockReturnValue(
      "playwright:\n  command: npx\n  args: [playwright-mcp]\n  description: Browser automation\n",
    );

    const items = indexSource(source);
    const mcpItems = items.filter((i) => i.type === "mcp");
    expect(mcpItems).toHaveLength(1);
    expect(mcpItems[0].name).toBe("playwright");
    expect(mcpItems[0].description).toBe("Browser automation");
  });

  it("scans rules/ directory for rule items", () => {
    const source: Source = {
      url: "/tmp/team-config",
      type: "local",
      skillsInstalled: [],
      availableItems: [],
      addedAt: "2026-01-01",
    };

    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path === "/tmp/team-config" || path.endsWith("rules");
    });

    mockReaddirSync.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("rules")) {
        return ["conventional-commits.md", "no-any.md"] as never;
      }
      return [] as never;
    });

    mockReadFileSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("conventional-commits")) return "# Conventional Commits\nUse feat: fix: etc.";
      return "# No Any\nAvoid any type in TypeScript.";
    });

    const items = indexSource(source);
    const ruleItems = items.filter((i) => i.type === "rule");
    expect(ruleItems).toHaveLength(2);
    expect(ruleItems[0].name).toBe("conventional-commits");
    expect(ruleItems[1].name).toBe("no-any");
  });

  it("scans commands/ directory for command items", () => {
    const source: Source = {
      url: "/tmp/team-config",
      type: "local",
      skillsInstalled: [],
      availableItems: [],
      addedAt: "2026-01-01",
    };

    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path === "/tmp/team-config" || path.endsWith("commands");
    });

    mockReaddirSync.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("commands")) {
        return ["deploy.md"] as never;
      }
      return [] as never;
    });

    mockReadFileSync.mockReturnValue("---\ndescription: Deploy the app\n---\n# Deploy\nRun deploy.");

    const items = indexSource(source);
    const commandItems = items.filter((i) => i.type === "command");
    expect(commandItems).toHaveLength(1);
    expect(commandItems[0].name).toBe("deploy");
  });

  it("returns empty commands when readFileSync throws inside commands/ scan", () => {
    const source: Source = {
      url: "/tmp/team-config-broken",
      type: "local",
      skillsInstalled: [],
      availableItems: [],
      addedAt: "2026-01-01",
    };

    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path === "/tmp/team-config-broken" || path.endsWith("commands");
    });

    mockReaddirSync.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("commands")) return ["broken.md"] as never;
      return [] as never;
    });

    mockReadFileSync.mockImplementation(() => {
      throw new Error("permission denied");
    });

    const items = indexSource(source);
    const commandItems = items.filter((i) => i.type === "command");
    expect(commandItems).toEqual([]);
  });

  it("returns empty rules when readFileSync throws inside rules/ scan", () => {
    const source: Source = {
      url: "/tmp/broken-rules-src",
      type: "local",
      skillsInstalled: [],
      availableItems: [],
      addedAt: "2026-01-01",
    };

    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path === "/tmp/broken-rules-src" || path === "/tmp/broken-rules-src/rules";
    });

    mockReaddirSync.mockImplementation((p) => {
      const path = String(p);
      if (path === "/tmp/broken-rules-src/rules") return ["broken-rule.md"] as never;
      return [] as never;
    });

    mockReadFileSync.mockImplementation(() => {
      throw new Error("read error in rules");
    });

    const items = indexSource(source);
    const ruleItems = items.filter((i) => i.type === "rule");
    expect(ruleItems).toEqual([]);
  });

  it("returns empty MCP servers when readFileSync throws for mcp-servers.yaml", () => {
    const source: Source = {
      url: "/tmp/team-config-broken-mcp",
      type: "local",
      skillsInstalled: [],
      availableItems: [],
      addedAt: "2026-01-01",
    };

    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path === "/tmp/team-config-broken-mcp" || path.endsWith("mcp-servers.yaml");
    });

    mockReaddirSync.mockReturnValue([] as never);

    mockReadFileSync.mockImplementation(() => {
      throw new Error("read error in mcp");
    });

    const items = indexSource(source);
    const mcpItems = items.filter((i) => i.type === "mcp");
    expect(mcpItems).toEqual([]);
  });

  it("returns empty MCP servers when YAML parses to non-object", () => {
    const source: Source = {
      url: "/tmp/mcp-invalid-yaml",
      type: "local",
      skillsInstalled: [],
      availableItems: [],
      addedAt: "2026-01-01",
    };

    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path === "/tmp/mcp-invalid-yaml" || path.endsWith("mcp-servers.yaml");
    });

    mockReaddirSync.mockReturnValue([] as never);
    mockReadFileSync.mockReturnValue("just a string, not a YAML mapping");

    const items = indexSource(source);
    const mcpItems = items.filter((i) => i.type === "mcp");
    expect(mcpItems).toEqual([]);
  });

  it("skips entries where no SKILL.md or DESIGN.md found", () => {
    const source: Source = {
      url: "/tmp/skill-no-def",
      type: "local",
      skillsInstalled: [],
      availableItems: [],
      addedAt: "2026-01-01",
    };

    // Only root dir exists, skill-a dir exists, but neither SKILL.md nor DESIGN.md
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path === "/tmp/skill-no-def";
    });

    mockReaddirSync.mockReturnValue([{ name: "skill-a", isDirectory: () => true, isFile: () => false }] as never);

    const items = indexSource(source);
    expect(items.filter((i) => i.type === "skill")).toEqual([]);
  });

  it("returns all content types from a source with mixed content", () => {
    const source: Source = {
      url: "/tmp/full-config",
      type: "local",
      skillsInstalled: [],
      availableItems: [],
      addedAt: "2026-01-01",
    };

    mockExistsSync.mockReturnValue(true);

    mockReaddirSync.mockImplementation((p) => {
      const path = String(p);
      if (path === "/tmp/full-config") {
        return [{ name: "my-skill", isDirectory: () => true, isFile: () => false }] as never;
      }
      if (path.endsWith("rules")) return ["team-rule.md"] as never;
      if (path.endsWith("commands")) return ["hello.md"] as never;
      return [] as never;
    });

    mockReadFileSync.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("SKILL.md")) return "---\nname: my-skill\ndescription: A skill\n---";
      if (path.endsWith("mcp-servers.yaml")) return "test-server:\n  command: echo\n";
      if (path.endsWith("team-rule.md")) return "# Team Rule\nFollow this.";
      if (path.endsWith("hello.md")) return "---\ndescription: Say hello\n---\n# Hello";
      return "";
    });

    const items = indexSource(source);
    expect(items.filter((i) => i.type === "skill")).toHaveLength(1);
    expect(items.filter((i) => i.type === "mcp")).toHaveLength(1);
    expect(items.filter((i) => i.type === "rule")).toHaveLength(1);
    expect(items.filter((i) => i.type === "command")).toHaveLength(1);
  });
});

describe("indexAllSources", () => {
  it("indexes multiple sources and updates metadata", async () => {
    const sources: Source[] = [
      {
        url: "/local/skills",
        type: "local",
        skillsInstalled: [],
        availableItems: [],
        addedAt: "2026-01-01",
      },
      {
        url: "/empty/dir",
        type: "local",
        skillsInstalled: [],
        availableItems: [],
        addedAt: "2026-01-01",
      },
    ];

    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path === "/local/skills") return true;
      if (path === "/empty/dir") return true;
      if (path.includes("/local/skills") && path.endsWith("SKILL.md")) return true;
      return false;
    });
    mockReaddirSync.mockImplementation((p) => {
      const path = String(p);
      if (path === "/local/skills") {
        return [{ name: "skill-a", isDirectory: () => true, isFile: () => false }] as never;
      }
      return [] as never;
    });
    mockReadFileSync.mockReturnValue("---\nname: skill-a\ndescription: Found\n---");

    await indexAllSources(sources);
    expect(sources[0].availableItems).toHaveLength(1);
    expect(sources[0].indexedAt).toBeDefined();
    expect(sources[1].availableItems).toHaveLength(0);
    expect(sources[1].indexedAt).toBeDefined();
  });
});

describe("getSourceCachePath with local sources (lines 309-313)", () => {
  const makeLocalSource = (url: string): Source => ({
    url,
    type: "local",
    skillsInstalled: [],
    availableItems: [],
    addedAt: "2026-01-01",
  });

  it("returns resolved local path when it exists", () => {
    mockExistsSync.mockReturnValue(true);
    const result = getSourceCachePath(makeLocalSource("/tmp/my-skills"));
    expect(result).toBe("/tmp/my-skills");
  });

  it("returns undefined when local path does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    const result = getSourceCachePath(makeLocalSource("/tmp/missing-dir"));
    expect(result).toBeUndefined();
  });

  it("expands tilde in local path", () => {
    mockExistsSync.mockReturnValue(true);
    const result = getSourceCachePath(makeLocalSource("~/my-skills"));
    // Tilde is expanded — result should be an absolute path, not start with ~
    expect(result).toBeDefined();
    expect(result).not.toMatch(/^~/);
  });
});

describe("cloneOrPull with targetSha after fresh clone (lines 284-295)", () => {
  const makeGithubSource = (url = "user/sha-repo"): Source => ({
    url,
    type: "github",
    skillsInstalled: [],
    availableItems: [],
    addedAt: "2026-01-01",
  });

  it("fetches unshallow and checks out sha after fresh clone succeeds", () => {
    // .git dir does not exist → will clone
    mockExistsSync.mockImplementation((path) => !String(path).includes(".git"));
    mockReaddirSync.mockReturnValue([] as never);

    const execCalls: string[][] = [];
    mockExecFileSync.mockImplementation((_cmd, args) => {
      execCalls.push(args as string[]);
      return "" as never;
    });

    indexSource({ ...makeGithubSource(), url: "user/sha-repo" });

    // Should have called clone, then fetch --unshallow and checkout are NOT called
    // because no sha option was provided — so just clone is called
    const cloneCall = execCalls.find((args) => args.includes("clone"));
    expect(cloneCall).toBeDefined();
  });

  it("fetches unshallow and checks out sha when targetSha is provided after fresh clone", () => {
    // .git dir does not exist → will clone
    mockExistsSync.mockImplementation((path) => !String(path).includes(".git"));
    mockReaddirSync.mockReturnValue([] as never);

    const execCalls: string[][] = [];
    mockExecFileSync.mockImplementation((_cmd, args) => {
      execCalls.push(args as string[]);
      return "" as never;
    });

    // getSourceCachePath passes sha option through to cloneOrPull
    const source = makeGithubSource("user/sha-pinned");
    getSourceCachePath(source, { sha: "abc123def456" });

    const unshallowCall = execCalls.find((args) => args.includes("--unshallow"));
    const checkoutCall = execCalls.find((args) => args.includes("checkout") && args.includes("abc123def456"));
    expect(unshallowCall).toBeDefined();
    expect(checkoutCall).toBeDefined();
  });

  it("silently continues when unshallow+checkout fails after fresh clone", () => {
    // .git dir does not exist → will clone
    mockExistsSync.mockImplementation((path) => !String(path).includes(".git"));
    mockReaddirSync.mockReturnValue([] as never);

    let callCount = 0;
    mockExecFileSync.mockImplementation((_cmd, args) => {
      callCount++;
      const argList = args as string[];
      // Clone succeeds, but fetch --unshallow throws
      if (argList.includes("--unshallow")) {
        throw new Error("shallow fetch failed");
      }
      return "" as never;
    });

    const source = makeGithubSource("user/sha-fail");
    // Should not throw — catch block swallows the error and uses HEAD
    const result = getSourceCachePath(source, { sha: "deadbeef" });
    expect(result).toBeDefined();
    expect(callCount).toBeGreaterThan(1);
  });

  it("checks out sha from session cache when already fetched and sha is provided (line 227)", () => {
    // .git exists → already cloned; first call populates session cache via pull
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([] as never);
    mockExecFileSync.mockReturnValue("" as never);

    const source = makeGithubSource("user/session-sha");

    // First call: populates session cache (pull succeeds)
    getSourceCachePath(source);

    // Second call: session cache hit — but with a sha this time
    const execCalls: string[][] = [];
    mockExecFileSync.mockImplementation((_cmd, args) => {
      execCalls.push(args as string[]);
      return "" as never;
    });

    const result = getSourceCachePath(source, { sha: "cafebabe" });
    expect(result).toBeDefined();
    // Should have called checkout with the sha (session-cache path)
    const checkoutCall = execCalls.find((args) => args.includes("checkout") && args.includes("cafebabe"));
    expect(checkoutCall).toBeDefined();
  });

  it("falls back to pull when fetch+checkout of sha fails for existing clone (line 242)", () => {
    // .git exists but NOT in session cache → will try fetch+checkout sha, then fall back to pull
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([] as never);

    const execCalls: string[][] = [];
    mockExecFileSync.mockImplementation((_cmd, args) => {
      execCalls.push(args as string[]);
      const argList = args as string[];
      // fetch origin succeeds, but checkout sha fails
      if (argList.includes("checkout")) {
        throw new Error("sha not found");
      }
      return "" as never;
    });

    const source = makeGithubSource("user/sha-fallback");
    const result = getSourceCachePath(source, { sha: "0000000" });

    expect(result).toBeDefined();
    // Should have attempted fetch origin and checkout, then fallen through to pull
    const fetchCall = execCalls.find((args) => args.includes("fetch") && args.includes("origin"));
    const pullCall = execCalls.find((args) => args.includes("pull"));
    expect(fetchCall).toBeDefined();
    expect(pullCall).toBeDefined();
  });

  it("silently ignores checkout error when sha provided but checkout fails in session cache (line 227)", () => {
    // .git exists; first call WITH SAME SHA populates session cache
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([] as never);

    // First call: fetch+checkout sha both succeed → session cache stores "user/session-sha-throw:baddcafe"
    mockExecFileSync.mockReturnValue("" as never);
    const source = makeGithubSource("user/session-sha-throw");
    getSourceCachePath(source, { sha: "baddcafe" }); // populates cache key "url:baddcafe"

    // Second call: same sha → session cache hit → tries checkout → throws — should still return path
    mockExecFileSync.mockImplementation((_cmd, args) => {
      const argList = args as string[];
      if (argList.includes("checkout")) throw new Error("detached head");
      return "" as never;
    });

    const result = getSourceCachePath(source, { sha: "baddcafe" });
    expect(result).toBeDefined();
  });

  it("uses source.url as git remote when source type is not github (line 209)", () => {
    const urlSource: Source = {
      url: "https://git.example.com/team/skills.git",
      type: "url",
      skillsInstalled: [],
      availableItems: [],
      addedAt: "2026-01-01",
    };

    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([] as never);

    const execCalls: string[][] = [];
    mockExecFileSync.mockImplementation((_cmd, args) => {
      execCalls.push(args as string[]);
      return "" as never;
    });

    getSourceCachePath(urlSource);

    // The URL is passed directly as the git remote (not prefixed with https://github.com/)
    const cloneCall = execCalls.find((args) => args.includes("clone"));
    expect(cloneCall).toContain("https://git.example.com/team/skills.git");
  });

  it("passes git@ GHE SSH URLs through when misclassified as github (team-skills regression)", () => {
    const gheSource: Source = {
      url: "git@corp-ghe.example.com:acme/team-skills.git",
      type: "github",
      skillsInstalled: [],
      availableItems: [],
      addedAt: "2026-01-01",
    };

    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([] as never);

    const execCalls: string[][] = [];
    mockExecFileSync.mockImplementation((_cmd, args) => {
      execCalls.push(args as string[]);
      return "" as never;
    });

    getSourceCachePath(gheSource);

    const cloneCall = execCalls.find((args) => args.includes("clone"));
    expect(cloneCall).toContain("git@corp-ghe.example.com:acme/team-skills.git");
    expect(cloneCall).not.toContain("https://github.com/git@");
    expect(cloneCall).not.toContain(".git.git");
  });

  it("uses fallback name when root SKILL.md read throws in single-skill repo (line 121)", () => {
    mockExistsSync.mockImplementation((path) => {
      const pathStr = String(path);
      // Repo dir exists, no subdirectory skills, but SKILL.md at root exists
      return pathStr === "/repo" || pathStr === "/repo/SKILL.md";
    });
    mockReaddirSync.mockReturnValue([] as never);
    // readFileSync throws for the root SKILL.md
    mockReadFileSync.mockImplementation(() => {
      throw new Error("read error");
    });

    const source: Source = {
      url: "/repo",
      type: "local",
      skillsInstalled: [],
      availableItems: [],
      addedAt: "2026-01-01",
    };

    const items = indexSource(source);
    expect(items).toHaveLength(1);
    // Falls back to directory name
    expect(items[0].name).toBe("repo");
    expect(items[0].description).toBe("");
    expect(items[0].type).toBe("skill");
  });
});

describe("classifyGitError", () => {
  it("detects 'could not read Username' as auth error", () => {
    const hint = classifyGitError("fatal: could not read Username for 'https://github.com': terminal prompts disabled");
    expect(hint).toContain("private");
    expect(hint).toContain("gh auth login");
  });

  it("detects 'Authentication failed' as auth error", () => {
    const hint = classifyGitError("fatal: Authentication failed for 'https://github.com/org/repo.git/'");
    expect(hint).toContain("private");
  });

  it("detects 'Repository not found' as auth error", () => {
    const hint = classifyGitError("ERROR: Repository not found.\nfatal: Could not read from remote repository.");
    expect(hint).toContain("private");
  });

  it("detects permission denied (publickey) as auth error", () => {
    const hint = classifyGitError(
      "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.",
    );
    expect(hint).toContain("SSH");
  });

  it("returns generic hint for non-auth errors", () => {
    const hint = classifyGitError("fatal: unable to access: Could not resolve host: github.com");
    expect(hint).toContain("internet");
  });

  it("returns GHE hint for GHE URLs regardless of stderr", () => {
    const hint = classifyGitError("fatal: some error", "github.mycompany.com/org/repo");
    expect(hint).toContain("GHE");
  });
});

describe("cloneOrPull error messages", () => {
  it("includes auth hint for private github.com repos", () => {
    const source: Source = {
      url: "private-org/secret-repo",
      type: "github",
      skillsInstalled: [],
      availableItems: [],
      addedAt: "2026-01-01",
    };

    mockExistsSync.mockReturnValue(false);
    mockExecFileSync.mockImplementation(() => {
      throw new Error("fatal: could not read Username for 'https://github.com': terminal prompts disabled");
    });

    expect(() => indexSource(source)).toThrow(/private/);
  });

  it("includes GHE hint for enterprise URLs", () => {
    const source: Source = {
      url: "https://github.mycompany.com/org/repo",
      type: "url",
      skillsInstalled: [],
      availableItems: [],
      addedAt: "2026-01-01",
    };

    mockExistsSync.mockReturnValue(false);
    mockExecFileSync.mockImplementation(() => {
      throw new Error("fatal: clone error");
    });

    expect(() => indexSource(source)).toThrow(/GHE/);
  });

  it("caches clone failures so repeated calls skip network", () => {
    const source: Source = {
      url: "private-org/failing-repo",
      type: "github",
      skillsInstalled: [],
      availableItems: [],
      addedAt: "2026-01-01",
    };

    mockExistsSync.mockReturnValue(false);
    mockExecFileSync.mockImplementation(() => {
      throw new Error("fatal: could not read Username");
    });

    // First call returns undefined (clone failure)
    const first = getSourceCachePath(source);
    expect(first).toBeUndefined();

    // Second call should return undefined without attempting clone again
    mockExecFileSync.mockClear();
    const second = getSourceCachePath(source);
    expect(second).toBeUndefined();
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("isSourceFailed returns true for URLs that failed clone", () => {
    const source: Source = {
      url: "private-org/failing-repo-2",
      type: "github",
      skillsInstalled: [],
      availableItems: [],
      addedAt: "2026-01-01",
    };

    mockExistsSync.mockReturnValue(false);
    mockExecFileSync.mockImplementation(() => {
      throw new Error("fatal: could not read Username");
    });

    expect(isSourceFailed(source.url)).toBe(false);
    getSourceCachePath(source);
    expect(isSourceFailed(source.url)).toBe(true);
  });

  it("isSourceFailed returns false after resetSessionCache", () => {
    const source: Source = {
      url: "private-org/failing-repo-3",
      type: "github",
      skillsInstalled: [],
      availableItems: [],
      addedAt: "2026-01-01",
    };

    mockExistsSync.mockReturnValue(false);
    mockExecFileSync.mockImplementation(() => {
      throw new Error("fatal: could not read Username");
    });

    getSourceCachePath(source);
    expect(isSourceFailed(source.url)).toBe(true);
    resetSessionCache();
    expect(isSourceFailed(source.url)).toBe(false);
  });
});
