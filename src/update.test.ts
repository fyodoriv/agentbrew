import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("./state.js", () => {
  const loadState = vi.fn();
  return { loadState, requireState: loadState, saveState: vi.fn() };
});

vi.mock("./sync/mcp-sync.js", () => ({
  syncMcpServers: vi.fn(),
}));

vi.mock("./sync/rules-sync.js", () => ({
  syncRules: vi.fn(),
}));

vi.mock("./sync/skills-sync.js", () => ({
  syncSkills: vi.fn(),
}));

vi.mock("./sync/command-sync.js", () => ({
  syncCommands: vi.fn(),
}));

vi.mock("./sync/agents-sync.js", () => ({
  syncAgentDefs: vi.fn(),
}));

vi.mock("./sync/instructions-sync.js", () => ({
  syncInstructions: vi.fn(),
}));

vi.mock("./catalog/index-source.js", () => ({
  indexAllSources: vi.fn(),
  getSourceCachePath: vi.fn(),
}));

vi.mock("./catalog/install-skill.js", () => ({
  copySkillFromCache: vi.fn(),
}));

vi.mock("./catalog/install-other.js", () => ({
  refreshRecommendedCatalogRules: vi.fn(() => ({ refreshed: [], unchanged: 0 })),
}));

vi.mock("./catalog/types.js", () => ({
  loadCatalog: vi.fn(() => ({ rules: [] })),
}));

vi.mock("./lock.js", () => ({
  readLock: vi.fn(),
  updateLock: vi.fn(),
}));

vi.mock("./skills/skill-versions.js", () => ({
  recordSourceSha: vi.fn(),
}));

vi.mock("./manifest.js", () => ({
  loadManifest: vi.fn(() => ({ hashes: {} })),
  saveManifest: vi.fn(),
}));

vi.mock("./core/errors.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./core/errors.js")>()),
  saveSyncErrors: vi.fn(),
  clearSyncErrors: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import { getSourceCachePath, indexAllSources } from "./catalog/index-source.js";
import { refreshRecommendedCatalogRules } from "./catalog/install-other.js";
import { copySkillFromCache } from "./catalog/install-skill.js";
import { loadCatalog } from "./catalog/types.js";
import { clearSyncErrors, saveSyncErrors } from "./core/errors.js";
import { readLock, updateLock } from "./lock.js";
import { loadManifest, saveManifest } from "./manifest.js";
import { loadState, saveState } from "./state.js";
import { syncAgentDefs } from "./sync/agents-sync.js";
import { syncCommands } from "./sync/command-sync.js";
import { syncInstructions } from "./sync/instructions-sync.js";
import { syncMcpServers } from "./sync/mcp-sync.js";
import { syncRules } from "./sync/rules-sync.js";
import { syncSkills } from "./sync/skills-sync.js";
import { clearMcpmBridgeAttemptedMissing, refreshInstalledSkills, update } from "./update.js";

const mockExecFileSync = vi.mocked(execFileSync);
const mockIndexAllSources = vi.mocked(indexAllSources);
const mockLoadState = vi.mocked(loadState);
const mockReadLock = vi.mocked(readLock);
const mockSaveState = vi.mocked(saveState);
const mockUpdateLock = vi.mocked(updateLock);
const mockSyncMcpServers = vi.mocked(syncMcpServers);
const mockSyncRules = vi.mocked(syncRules);
const mockSyncSkills = vi.mocked(syncSkills);
const mockSyncCommands = vi.mocked(syncCommands);
const mockSyncAgentDefs = vi.mocked(syncAgentDefs);
const mockSyncInstructions = vi.mocked(syncInstructions);
const mockGetSourceCachePath = vi.mocked(getSourceCachePath);
const mockCopySkillFromCache = vi.mocked(copySkillFromCache);
const mockLoadManifest = vi.mocked(loadManifest);
const mockSaveManifest = vi.mocked(saveManifest);
const mockRefreshRecommendedCatalogRules = vi.mocked(refreshRecommendedCatalogRules);
const mockLoadCatalog = vi.mocked(loadCatalog);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockReadLock.mockReturnValue({ locked: [] });
  mockUpdateLock.mockReturnValue([]);
});

function makeState() {
  return {
    agents: [{ name: "claude-code", detected: true, skillsDir: "x" }],
    sources: [],
    mcpServers: [],
    catalogVersion: "0.1.0",
  };
}

function makeSource(overrides?: Partial<{ url: string; type: string; skillsInstalled: string[] }>) {
  return {
    url: overrides?.url ?? "user/repo",
    type: (overrides?.type ?? "github") as "github" | "local" | "url",
    skillsInstalled: overrides?.skillsInstalled ?? ["debug", "plan"],
    availableItems: [],
    addedAt: "2026-01-01",
    commitSha: "abc123",
  };
}

describe("update", () => {
  it("returns early when not initialized", async () => {
    mockLoadState.mockReturnValue(undefined);
    await update();
    expect(mockSaveState).not.toHaveBeenCalled();
  });

  it("runs skill check and sync", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExecFileSync.mockReturnValue("up to date" as never);
    await update();
    expect(console.log).toHaveBeenCalled();
    expect(mockRefreshRecommendedCatalogRules).toHaveBeenCalled();
    expect(mockLoadCatalog).toHaveBeenCalled();
  });

  it("calls all sync engines", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExecFileSync.mockReturnValue("up to date" as never);
    await update();
    expect(mockSyncMcpServers).toHaveBeenCalledOnce();
    expect(mockSyncRules).toHaveBeenCalledOnce();
    expect(mockSyncSkills).toHaveBeenCalledOnce();
    expect(mockSyncCommands).toHaveBeenCalledOnce();
    expect(mockSyncAgentDefs).toHaveBeenCalledOnce();
    expect(mockSyncInstructions).toHaveBeenCalledOnce();
  });

  it("records a clean sync so status shows the new last-sync time", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExecFileSync.mockReturnValue("up to date" as never);
    await update();
    expect(vi.mocked(clearSyncErrors)).toHaveBeenCalledOnce();
    expect(vi.mocked(saveSyncErrors)).not.toHaveBeenCalled();
  });

  it("keeps syncing after an engine fails and records the error", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExecFileSync.mockReturnValue("up to date" as never);
    mockSyncRules.mockRejectedValueOnce(new Error("rules exploded"));
    const previousExitCode = process.exitCode;
    try {
      await update();
      expect(mockSyncInstructions).toHaveBeenCalledOnce();
      expect(vi.mocked(clearSyncErrors)).not.toHaveBeenCalled();
      const collector = vi.mocked(saveSyncErrors).mock.calls[0]?.[0];
      expect(collector?.errors.map((e) => e.message)).toEqual(["[rules] rules exploded"]);
      expect(process.exitCode).toBe(1);
      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("Update complete"));
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("handles npx skills not available (ENOENT)", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });
    await update();
    expect(console.log).toHaveBeenCalled();
  });

  it("handles genuine skills check failure (non-ENOENT error)", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExecFileSync.mockImplementation(() => {
      throw new Error("spawn failed: permission denied");
    });
    await update();
    const logCalls = [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls].flat().join(" ");
    expect(logCalls).toMatch(/skills check failed/);
  });

  it("prints verbatim output for unrecognized skills check response", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExecFileSync.mockReturnValue("some unexpected output format" as never);
    await update();
    const logCalls = [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls].flat().join(" ");
    expect(logCalls).toMatch(/unrecognized format/);
  });

  it("updates skills when outdated", async () => {
    mockLoadState.mockReturnValue(makeState());
    let callCount = 0;
    mockExecFileSync.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return "outdated skill" as never;
      return "" as never;
    });
    await update();
    expect(mockExecFileSync).toHaveBeenCalledTimes(2);
  });

  it("re-indexes sources during update", async () => {
    mockLoadState.mockReturnValue({
      ...makeState(),
      sources: [
        { url: "user/repo", type: "github" as const, skillsInstalled: [], availableItems: [], addedAt: "2026-01-01" },
      ],
    });
    mockExecFileSync.mockReturnValue("up to date" as never);
    await update();
    expect(mockIndexAllSources).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ url: "user/repo" })]),
    );
    expect(mockSaveState).toHaveBeenCalled();
  });

  it("skips source indexing when no sources", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExecFileSync.mockReturnValue("up to date" as never);
    await update();
    expect(mockIndexAllSources).not.toHaveBeenCalled();
  });

  it("reports lock file updated status", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExecFileSync.mockReturnValue("up to date" as never);
    mockReadLock.mockReturnValue({
      locked: [{ source: "user/repo", type: "github", sha: "abc123", skills: [], lockedAt: "2026-01-01" }],
    });
    mockUpdateLock.mockReturnValue([{ source: "user/repo", status: "updated", sha: "newsha1", oldSha: "oldsha1" }]);
    await update();
    const logCalls = [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls].flat().join(" ");
    expect(logCalls).toMatch(/user\/repo/);
  });

  it("reports lock file up-to-date status", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExecFileSync.mockReturnValue("up to date" as never);
    mockReadLock.mockReturnValue({
      locked: [{ source: "user/repo", type: "github", sha: "abc123", skills: [], lockedAt: "2026-01-01" }],
    });
    mockUpdateLock.mockReturnValue([{ source: "user/repo", status: "up-to-date", sha: "abc123", oldSha: "abc123" }]);
    await update();
    const logCalls = [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls].flat().join(" ");
    expect(logCalls).toMatch(/up to date/);
  });

  it("reports lock file error status", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExecFileSync.mockReturnValue("up to date" as never);
    mockReadLock.mockReturnValue({
      locked: [{ source: "user/repo", type: "github", sha: "abc123", skills: [], lockedAt: "2026-01-01" }],
    });
    mockUpdateLock.mockReturnValue([{ source: "user/repo", status: "error", sha: undefined, oldSha: undefined }]);
    await update();
    const logCalls = [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls].flat().join(" ");
    expect(logCalls).toMatch(/could not resolve SHA/);
  });

  it("refreshes installed skills from source caches", async () => {
    const source = makeSource();
    mockLoadState.mockReturnValue({ ...makeState(), sources: [source] });
    mockExecFileSync.mockReturnValue("up to date" as never);
    mockGetSourceCachePath.mockReturnValue("/cache/user-repo");
    mockCopySkillFromCache.mockReturnValue("/installed/debug");
    await update();
    expect(mockCopySkillFromCache).toHaveBeenCalledWith("/cache/user-repo", "debug");
    expect(mockCopySkillFromCache).toHaveBeenCalledWith("/cache/user-repo", "plan");
  });

  it("skips npx skills check and sync engines in dry-run mode", async () => {
    const source = makeSource();
    mockLoadState.mockReturnValue({ ...makeState(), sources: [source] });
    mockGetSourceCachePath.mockReturnValue("/cache/user-repo");
    await update({ dryRun: true });
    expect(mockExecFileSync).not.toHaveBeenCalled();
    expect(mockIndexAllSources).not.toHaveBeenCalled();
    expect(mockSyncMcpServers).not.toHaveBeenCalled();
    expect(mockSyncSkills).not.toHaveBeenCalled();
    const logCalls = [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls].flat().join(" ");
    expect(logCalls).toMatch(/dry-run/);
  });

  it("filters to single skill when skillName is provided", async () => {
    const source = makeSource({ skillsInstalled: ["debug", "plan", "review"] });
    mockLoadState.mockReturnValue({ ...makeState(), sources: [source] });
    mockExecFileSync.mockReturnValue("up to date" as never);
    mockGetSourceCachePath.mockReturnValue("/cache/user-repo");
    mockCopySkillFromCache.mockReturnValue("/installed/debug");
    await update({ skillName: "debug" });
    expect(mockCopySkillFromCache).toHaveBeenCalledTimes(1);
    expect(mockCopySkillFromCache).toHaveBeenCalledWith("/cache/user-repo", "debug");
  });

  it("skips npx skills check when updating a single skill", async () => {
    const source = makeSource();
    mockLoadState.mockReturnValue({ ...makeState(), sources: [source] });
    mockExecFileSync.mockReturnValue("up to date" as never);
    mockGetSourceCachePath.mockReturnValue("/cache/user-repo");
    mockCopySkillFromCache.mockReturnValue("/installed/debug");
    await update({ skillName: "debug" });
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });
});

// sync-idempotent-and-complete (TASKS.md) criterion (b): --pull is the
// user's explicit "external sources may have moved" signal, so the
// mcpm-bridge attempted-missing cache must be cleared. Without this,
// a server mcpm couldn't resolve at sync time would stay perma-cached
// and the user couldn't retry without manually editing the manifest.
describe("clearMcpmBridgeAttemptedMissing", () => {
  it("clears mcpmBridgeAttemptedMissing and saves the manifest when entries exist", () => {
    mockLoadManifest.mockReturnValue({
      hashes: {},
      mcpmBridgeAttemptedMissing: ["tasks-mcp", "jenkins"],
    });

    clearMcpmBridgeAttemptedMissing();

    expect(mockSaveManifest).toHaveBeenCalledOnce();
    const savedManifest = mockSaveManifest.mock.calls[0][0];
    expect(savedManifest.mcpmBridgeAttemptedMissing).toEqual([]);
  });

  it("is a no-op when the cache is already empty", () => {
    mockLoadManifest.mockReturnValue({ hashes: {} });

    clearMcpmBridgeAttemptedMissing();

    expect(mockSaveManifest).not.toHaveBeenCalled();
  });

  it("is a no-op when the cache is an explicit empty array", () => {
    mockLoadManifest.mockReturnValue({ hashes: {}, mcpmBridgeAttemptedMissing: [] });

    clearMcpmBridgeAttemptedMissing();

    expect(mockSaveManifest).not.toHaveBeenCalled();
  });

  it("update() invokes the cache clear before re-indexing sources", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockLoadManifest.mockReturnValue({
      hashes: {},
      mcpmBridgeAttemptedMissing: ["tasks-mcp"],
    });
    mockExecFileSync.mockReturnValue("up to date" as never);

    await update();

    // Cache cleared during update() (saveManifest hits because the
    // pre-clear cache was non-empty).
    const savedManifests = mockSaveManifest.mock.calls.map((c) => c[0]);
    expect(savedManifests.some((m) => m.mcpmBridgeAttemptedMissing?.length === 0)).toBe(true);
  });

  it("update({ dryRun: true }) does NOT clear the cache (no side effects)", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockLoadManifest.mockReturnValue({
      hashes: {},
      mcpmBridgeAttemptedMissing: ["tasks-mcp"],
    });
    mockExecFileSync.mockReturnValue("up to date" as never);

    await update({ dryRun: true });

    expect(mockSaveManifest).not.toHaveBeenCalled();
  });
});

describe("refreshInstalledSkills", () => {
  it("skips local sources", () => {
    const source = makeSource({ type: "local" });
    mockGetSourceCachePath.mockReturnValue("/cache/local");
    const results = refreshInstalledSkills([source]);
    expect(results).toHaveLength(0);
    expect(mockCopySkillFromCache).not.toHaveBeenCalled();
  });

  it("skips sources with no installed skills", () => {
    const source = makeSource({ skillsInstalled: [] });
    const results = refreshInstalledSkills([source]);
    expect(results).toHaveLength(0);
  });

  it("copies all installed skills from cache", () => {
    const source = makeSource({ skillsInstalled: ["debug", "plan"] });
    mockGetSourceCachePath.mockReturnValue("/cache/user-repo");
    mockCopySkillFromCache.mockReturnValue("/installed/skill");
    const results = refreshInstalledSkills([source]);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ source: "user/repo", skill: "debug", status: "refreshed" });
    expect(results[1]).toEqual({ source: "user/repo", skill: "plan", status: "refreshed" });
  });

  it("reports failed status when copy returns undefined", () => {
    const source = makeSource({ skillsInstalled: ["missing-skill"] });
    mockGetSourceCachePath.mockReturnValue("/cache/user-repo");
    mockCopySkillFromCache.mockReturnValue(undefined);
    const results = refreshInstalledSkills([source]);
    expect(results[0]).toEqual({ source: "user/repo", skill: "missing-skill", status: "failed" });
  });

  it("filters to single skill in skillName mode", () => {
    const source = makeSource({ skillsInstalled: ["debug", "plan", "review"] });
    mockGetSourceCachePath.mockReturnValue("/cache/user-repo");
    mockCopySkillFromCache.mockReturnValue("/installed/plan");
    const results = refreshInstalledSkills([source], { skillName: "plan" });
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ source: "user/repo", skill: "plan", status: "refreshed" });
    expect(mockCopySkillFromCache).toHaveBeenCalledTimes(1);
  });

  it("does not copy in dry-run mode", () => {
    const source = makeSource({ skillsInstalled: ["debug"] });
    mockGetSourceCachePath.mockReturnValue("/cache/user-repo");
    const results = refreshInstalledSkills([source], { dryRun: true });
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ source: "user/repo", skill: "debug", status: "refreshed" });
    expect(mockCopySkillFromCache).not.toHaveBeenCalled();
  });

  it("skips source when cache path is unavailable", () => {
    const source = makeSource({ skillsInstalled: ["debug"] });
    mockGetSourceCachePath.mockReturnValue(undefined);
    const results = refreshInstalledSkills([source]);
    expect(results).toHaveLength(0);
    expect(mockCopySkillFromCache).not.toHaveBeenCalled();
  });
});
