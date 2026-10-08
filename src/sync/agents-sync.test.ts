import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  rmSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock("write-file-atomic", () => ({
  sync: vi.fn(),
}));

vi.mock("../manifest.js", () => ({
  loadManifest: vi.fn(() => ({ hashes: {} })),
  saveManifest: vi.fn(),
  writeIfChanged: vi.fn(() => true),
  removeFromManifest: vi.fn(),
  contentHash: vi.fn(() => "mock-hash"),
}));

vi.mock("../state.js", () => ({
  loadState: vi.fn(() => undefined),
  saveState: vi.fn(),
}));

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { loadManifest, saveManifest, writeIfChanged } from "../manifest.js";
import { loadState, saveState } from "../state.js";
import { AGENT_DEFINITIONS } from "../types.js";
import {
  addAgentSource,
  collectAgentDefs,
  getAgentDefTargets,
  getAgentSources,
  initAgentDefs,
  listAgentDefs,
  syncAgentDefs,
} from "./agents-sync.js";

const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteIfChanged = vi.mocked(writeIfChanged);
const mockSaveManifest = vi.mocked(saveManifest);
const mockUnlinkSync = vi.mocked(unlinkSync);
const mockRmSync = vi.mocked(rmSync);
const mockLoadState = vi.mocked(loadState);
const mockSaveState = vi.mocked(saveState);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const AGENT_DEF = `---
name: Developer
model: claude-opus-4-6
---

You are a senior developer.
`;

describe("collectAgentDefs", () => {
  it("collects definitions from a single source", () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["developer.md", "reviewer.md"] as unknown as ReturnType<typeof readdirSync>);

    const { agents, bySource } = collectAgentDefs([{ label: "test", path: "/tmp/agents" }]);
    expect(agents.size).toBe(2);
    expect(agents.get("developer")?.sourceLabel).toBe("test");
    expect(bySource.test).toBe(2);
  });

  it("deduplicates by name — first source wins", () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync
      .mockReturnValueOnce(["developer.md"] as unknown as ReturnType<typeof readdirSync>)
      .mockReturnValueOnce(["developer.md", "researcher.md"] as unknown as ReturnType<typeof readdirSync>);

    const { agents, bySource } = collectAgentDefs([
      { label: "primary", path: "/primary" },
      { label: "secondary", path: "/secondary" },
    ]);
    expect(agents.size).toBe(2);
    expect(agents.get("developer")?.sourceLabel).toBe("primary");
    expect(agents.get("researcher")?.sourceLabel).toBe("secondary");
    expect(bySource.primary).toBe(1);
    expect(bySource.secondary).toBe(1);
  });

  it("skips non-existent source directories", () => {
    mockExistsSync.mockReturnValue(false);

    const { agents } = collectAgentDefs([{ label: "missing", path: "/no/such/dir" }]);
    expect(agents.size).toBe(0);
  });

  it("returns empty map when all sources are empty", () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);

    const { agents } = collectAgentDefs([{ label: "empty", path: "/empty" }]);
    expect(agents.size).toBe(0);
  });
});

describe("getAgentSources", () => {
  it("returns built-in source when no state configured", () => {
    const sources = getAgentSources({ agentSourceDirs: undefined } as never);
    expect(sources).toHaveLength(1);
    expect(sources[0].label).toBe("agentbrew");
  });

  it("returns built-in + user sources from state", () => {
    const sources = getAgentSources({
      agentSourceDirs: [{ label: "minsky", path: "/Users/test/minsky/agents" }],
    } as never);
    expect(sources).toHaveLength(2);
    expect(sources[0].label).toBe("agentbrew");
    expect(sources[1].label).toBe("minsky");
  });
});

describe("syncAgentDefs", () => {
  it("skips silently when no sources have any definitions (default sync)", async () => {
    mockExistsSync.mockReturnValue(false);
    mockLoadState.mockReturnValue(undefined);
    await syncAgentDefs();
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining("No agent definitions directory"));
  });

  it("warns when no sources have any definitions and verbose", async () => {
    mockExistsSync.mockReturnValue(false);
    mockLoadState.mockReturnValue(undefined);
    await syncAgentDefs({ verbose: true });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("No agent definitions directory"));
  });

  it("skips quietly when no definitions and quiet", async () => {
    mockExistsSync.mockReturnValue(false);
    mockLoadState.mockReturnValue(undefined);
    await syncAgentDefs({ quiet: true });
    expect(console.log).not.toHaveBeenCalled();
  });

  it("skips when source dir exists but has no .md files", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);
    mockLoadState.mockReturnValue(undefined);
    await syncAgentDefs({ verbose: true });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("No agent definitions found"));
  });

  it("syncs files to target agents", async () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("agentbrew/agents")) return true;
      return false;
    });
    mockReaddirSync.mockReturnValue(["developer.md"] as unknown as ReturnType<typeof readdirSync>);
    mockReadFileSync.mockReturnValue(AGENT_DEF);
    mockLoadState.mockReturnValue(undefined);

    await syncAgentDefs();
    expect(mockWriteIfChanged).toHaveBeenCalled();
    expect(mockMkdirSync).toHaveBeenCalled();
  });

  it("delegates skip logic to writeIfChanged", async () => {
    // Pre-populate manifest so isUserModified recognizes target files as agentbrew-deployed
    const manifestHashes: Record<string, string> = {};
    vi.mocked(loadManifest).mockImplementation(() => ({ hashes: manifestHashes }));
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith(".md") && !path.includes("agentbrew/agents")) {
        manifestHashes[path] = "mock-hash";
      }
      return true;
    });
    mockReaddirSync.mockReturnValue(["developer.md"] as unknown as ReturnType<typeof readdirSync>);
    mockReadFileSync.mockReturnValue(AGENT_DEF);
    mockWriteIfChanged.mockReturnValue(false);
    mockLoadState.mockReturnValue(undefined);

    await syncAgentDefs();
    expect(mockWriteIfChanged).toHaveBeenCalled();
    expect(mockSaveManifest).toHaveBeenCalled();
  });

  it("migrates legacy permission patterns in-place for user-modified agent files", async () => {
    const manifestHashes: Record<string, string> = {};
    vi.mocked(loadManifest).mockImplementation(() => ({ hashes: manifestHashes }));
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["developer.md"] as unknown as ReturnType<typeof readdirSync>);
    mockReadFileSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("agentbrew/agents")) return AGENT_DEF;
      if (path.endsWith(".md")) {
        manifestHashes[path] = "deployed-hash";
        return `---
permissions:
  allow:
    - Exec(git *)
---
You are a senior developer with custom edits.
`;
      }
      return AGENT_DEF;
    });
    mockLoadState.mockReturnValue(undefined);
    mockWriteIfChanged.mockReturnValue(true);

    await syncAgentDefs();

    expect(mockWriteIfChanged).toHaveBeenCalledWith(
      expect.stringMatching(/\.md$/),
      expect.stringContaining("Bash(git *)"),
      expect.objectContaining({ hashes: manifestHashes }),
    );
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("(user-modified)"));
  });

  it("skips unreadable source files during sync and continues with remaining files", async () => {
    const manifestHashes: Record<string, string> = {};
    vi.mocked(loadManifest).mockImplementation(() => ({ hashes: manifestHashes }));
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith(".md") && !path.includes("agentbrew/agents")) {
        manifestHashes[path] = "mock-hash";
      }
      return true;
    });
    mockReaddirSync.mockReturnValue(["good.md", "bad.md"] as unknown as ReturnType<typeof readdirSync>);
    mockReadFileSync.mockImplementation((p) => {
      if (String(p).includes("bad")) throw new Error("EACCES");
      return AGENT_DEF;
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockLoadState.mockReturnValue(undefined);

    await syncAgentDefs();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("bad.md"));
    expect(mockWriteIfChanged).toHaveBeenCalled();
  });

  it("does not write in dry-run mode", async () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("agentbrew/agents")) return true;
      return false;
    });
    mockReaddirSync.mockReturnValue(["developer.md"] as unknown as ReturnType<typeof readdirSync>);
    mockReadFileSync.mockReturnValue(AGENT_DEF);
    mockLoadState.mockReturnValue(undefined);

    await syncAgentDefs({ dryRun: true });
    expect(mockWriteIfChanged).not.toHaveBeenCalled();
    expect(mockMkdirSync).not.toHaveBeenCalled();
  });

  it("prunes only manifest-tracked files not in source", async () => {
    mockExistsSync.mockReturnValue(true);
    let callCount = 0;
    mockReaddirSync.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return ["developer.md"] as unknown as ReturnType<typeof readdirSync>;
      return ["developer.md", "old-agent.md"] as unknown as ReturnType<typeof readdirSync>;
    });
    mockReadFileSync.mockReturnValue(AGENT_DEF);
    mockLoadState.mockReturnValue(undefined);
    // Simulate that old-agent.md was previously deployed by agentbrew: the manifest
    // tracks every old-agent path, whichever target dir it lives in.
    const trackedHashes = new Proxy({} as Record<string, string>, {
      get: (_target, key) => (typeof key === "string" && key.includes("old-agent") ? "mock-hash" : undefined),
    });
    vi.mocked(loadManifest).mockImplementation(() => ({ hashes: trackedHashes }));

    await syncAgentDefs({ prune: true });
    expect(mockUnlinkSync).toHaveBeenCalledWith(expect.stringContaining("old-agent.md"));
  });

  it("syncs definitions from multiple source directories", async () => {
    const manifestHashes: Record<string, string> = {};
    vi.mocked(loadManifest).mockImplementation(() => ({ hashes: manifestHashes }));
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith(".md") && !path.includes("agentbrew/agents") && !path.includes("minsky")) {
        manifestHashes[path] = "mock-hash";
      }
      return true;
    });
    let readDirCall = 0;
    mockReaddirSync.mockImplementation(() => {
      readDirCall++;
      if (readDirCall === 1) return ["developer.md"] as unknown as ReturnType<typeof readdirSync>;
      if (readDirCall === 2) return ["researcher.md", "developer.md"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    mockReadFileSync.mockReturnValue(AGENT_DEF);
    mockLoadState.mockReturnValue({
      agentSourceDirs: [{ label: "minsky", path: "/Users/test/minsky/agents" }],
    } as never);

    await syncAgentDefs();
    // Should sync developer (built-in) and researcher (minsky overlay) without duplicates
    expect(mockWriteIfChanged).toHaveBeenCalled();
  });
});

describe("syncAgentDefs — subdir format", () => {
  // No built-in agent uses the "subdir" format; register a fixture agent in the
  // module-scope AGENT_DEFINITIONS array for these tests and remove it after.
  const subdirAgent = {
    name: "subdir-fixture-agent",
    skillsDir: "~/.config/subdir-fixture-agent/skills",
    agentsDir: "~/.config/subdir-fixture-agent/agents",
    agentsDirFormat: "subdir" as const,
  };
  beforeEach(() => {
    AGENT_DEFINITIONS.push(subdirAgent);
  });
  afterEach(() => {
    const index = AGENT_DEFINITIONS.indexOf(subdirAgent);
    if (index !== -1) AGENT_DEFINITIONS.splice(index, 1);
  });

  it("writes AGENT.md inside a named subdirectory for subdir-format targets", async () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("agentbrew/agents")) return true;
      return false;
    });
    mockReaddirSync.mockReturnValue(["developer.md"] as unknown as ReturnType<typeof readdirSync>);
    mockReadFileSync.mockReturnValue(AGENT_DEF);
    mockLoadState.mockReturnValue(undefined);

    await syncAgentDefs();

    const subdirWrite = vi
      .mocked(writeIfChanged)
      .mock.calls.find(([path]) => String(path).includes("subdir-fixture-agent") && String(path).endsWith("AGENT.md"));
    expect(subdirWrite).toBeDefined();
    expect(String(subdirWrite?.[0])).toMatch(/developer[/\\]AGENT\.md$/);
  });

  it("creates the named subdirectory when writing in subdir format", async () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.includes("agentbrew/agents")) return true;
      return false;
    });
    mockReaddirSync.mockReturnValue(["reviewer.md"] as unknown as ReturnType<typeof readdirSync>);
    mockReadFileSync.mockReturnValue(AGENT_DEF);
    mockLoadState.mockReturnValue(undefined);

    await syncAgentDefs();

    const subdirCreated = vi
      .mocked(mkdirSync)
      .mock.calls.some(([path]) => String(path).includes("subdir-fixture-agent") && String(path).endsWith("reviewer"));
    expect(subdirCreated).toBe(true);
  });

  it("prunes only manifest-tracked stale subdirs in subdir format", async () => {
    const manifestHashes: Record<string, string> = {};
    vi.mocked(loadManifest).mockImplementation(() => ({ hashes: manifestHashes }));

    let callCount = 0;
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      // Track old-agent AGENT.md paths as "deployed" in manifest
      if (path.includes("old-agent") && path.endsWith("AGENT.md")) {
        manifestHashes[path] = "mock-hash";
      }
      if (path.includes("agentbrew/agents")) return true;
      if (path.endsWith("AGENT.md")) return true;
      return false;
    });
    mockReaddirSync.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return ["developer.md"] as unknown as ReturnType<typeof readdirSync>;
      return ["developer", "old-agent"] as unknown as ReturnType<typeof readdirSync>;
    });
    mockReadFileSync.mockReturnValue(AGENT_DEF);
    mockLoadState.mockReturnValue(undefined);

    await syncAgentDefs({ prune: true });

    expect(mockRmSync).toHaveBeenCalledWith(
      expect.stringContaining("old-agent"),
      expect.objectContaining({ recursive: true }),
    );
  });
});

describe("initAgentDefs", () => {
  it("creates directory when it does not exist", async () => {
    mockExistsSync.mockReturnValue(false);
    await initAgentDefs();
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining("agentbrew/agents"), { recursive: true });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("created"));
  });

  it("warns when directory already has files", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["developer.md"] as unknown as ReturnType<typeof readdirSync>);
    await initAgentDefs();
    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("already exists"));
  });
});

describe("listAgentDefs", () => {
  it("warns when no directory and no definitions", async () => {
    mockExistsSync.mockReturnValue(false);
    mockLoadState.mockReturnValue(undefined);
    await listAgentDefs();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("No agent definitions directory"));
  });

  it("lists definitions with name and model", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["developer.md"] as unknown as ReturnType<typeof readdirSync>);
    mockReadFileSync.mockReturnValue(AGENT_DEF);
    mockLoadState.mockReturnValue(undefined);
    await listAgentDefs();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Developer"));
  });

  it("skips unreadable files and warns", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["good.md", "bad.md"] as unknown as ReturnType<typeof readdirSync>);
    mockReadFileSync.mockImplementation((p) => {
      if (String(p).includes("bad")) throw new Error("EACCES");
      return AGENT_DEF;
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockLoadState.mockReturnValue(undefined);
    await listAgentDefs();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("bad.md"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Developer"));
  });
});

describe("addAgentSource", () => {
  it("registers a new source directory in state", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["researcher.md"] as unknown as ReturnType<typeof readdirSync>);
    mockLoadState.mockReturnValue({ agentSourceDirs: [] } as never);

    await addAgentSource("minsky", "/Users/test/minsky/agents");

    expect(mockSaveState).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSourceDirs: [{ label: "minsky", path: "/Users/test/minsky/agents" }],
      }),
    );
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("registered"));
  });

  it("rejects non-existent paths", async () => {
    mockExistsSync.mockReturnValue(false);
    mockLoadState.mockReturnValue({ agentSourceDirs: [] } as never);

    await addAgentSource("missing", "/no/such/path");

    expect(mockSaveState).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
  });

  it("skips duplicate sources", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([] as unknown as ReturnType<typeof readdirSync>);
    mockLoadState.mockReturnValue({
      agentSourceDirs: [{ label: "minsky", path: "/Users/test/minsky/agents" }],
    } as never);

    await addAgentSource("minsky-2", "/Users/test/minsky/agents");

    expect(mockSaveState).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("already tracked"));
  });
});

// Regression guard for getAgentDefTargets() filter: agents without an
// `agentsDir` (e.g. `copilot`, `augment`) must be dropped. A flipped filter
// would either write agent definitions to every agent (noise) or skip all
// of them (silent breakage). See TASKS.md
// `sync-unsupported-agent-coverage-extended`.
describe("getAgentDefTargets — unsupported-agent skip coverage", () => {
  it("excludes agents without an agentsDir, keeps the ones that have one", () => {
    const names = getAgentDefTargets().map((t) => t.agentName);
    expect(names).toContain("claude-code");
    expect(names).not.toContain("augment");
    expect(names).not.toContain("copilot");
  });

  it("every returned target has a non-empty dir and a format", () => {
    for (const target of getAgentDefTargets()) {
      expect(target.dir).toMatch(/\S/u);
      expect(target.format === "flat" || target.format === "subdir").toBe(true);
    }
  });
});

// An agent the state marks `detected: false` (not installed, or listed in the
// Agentfile's `excludeAgents`) must get no agents dir. Creating one makes the
// next sync detect the agent again, because detection checks that the
// agent's config dir exists.
describe("undetected agents get no agent definitions", () => {
  it("getAgentDefTargets drops names in the skip set", () => {
    const names = getAgentDefTargets(new Set(["cursor"])).map((t) => t.agentName);
    expect(names).not.toContain("cursor");
    expect(names).toContain("claude-code");
  });

  it("getAgentDefTargets keeps every agentsDir agent without a skip set", () => {
    expect(getAgentDefTargets().map((t) => t.agentName)).toContain("cursor");
  });

  it("syncAgentDefs creates no dir for an agent the state marks not detected", async () => {
    mockExistsSync.mockImplementation((p) => String(p).includes("agentbrew/agents"));
    mockReaddirSync.mockReturnValue(["developer.md"] as unknown as ReturnType<typeof readdirSync>);
    mockReadFileSync.mockReturnValue(AGENT_DEF);
    mockLoadState.mockReturnValue({
      agents: [{ name: "cursor", detected: false }],
    } as unknown as ReturnType<typeof loadState>);

    await syncAgentDefs({ quiet: true });

    const dirs = mockMkdirSync.mock.calls.map((call) => String(call[0]));
    expect(dirs.some((d) => d.includes(".cursor/agents"))).toBe(false);
    expect(dirs.some((d) => d.includes(".claude/agents"))).toBe(true);
  });
});
