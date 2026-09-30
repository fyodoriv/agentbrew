import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, existsSync: vi.fn(() => false), readFileSync: vi.fn(() => ""), readdirSync: vi.fn(() => []) };
});

vi.mock("./sync/skills-sync.js", async () => {
  // Keep `collectSkills` real — the cross-site consistency tests in this file
  // assert that `status` and the `collectSkills` helper agree on the canonical
  // count, so mocking `collectSkills` would defeat the test.
  const actual = await vi.importActual<typeof import("./sync/skills-sync.js")>("./sync/skills-sync.js");
  return {
    ...actual,
    getSkillSources: vi.fn(() => []),
  };
});

vi.mock("./sync/instructions-sync.js", () => ({
  loadInstructions: vi.fn(() => undefined),
  isInstructionsUpToDate: (deployed: string, content: string) =>
    deployed === content || deployed.startsWith(content.trimEnd()),
}));

vi.mock("./state.js", () => {
  const loadState = vi.fn();
  return { loadState, requireState: loadState, getStatePath: vi.fn(() => "/mock/.config/agentbrew/state.yaml") };
});

vi.mock("./core/errors.js", () => ({
  loadSyncErrors: vi.fn(() => undefined),
}));

vi.mock("./sync/auto-repair-health.js", async () => {
  const actual = await vi.importActual<typeof import("./sync/auto-repair-health.js")>("./sync/auto-repair-health.js");
  return { ...actual, probeAutoRepairHealth: vi.fn(() => ({ backend: "none", state: "not-installed" })) };
});

vi.mock("./mcp/health-snapshot.js", () => ({
  loadMcpHealthSnapshot: vi.fn(() => undefined),
  unhealthyMcpEntries: vi.fn((snapshot: { servers?: Array<{ status: string }> } | undefined) =>
    (snapshot?.servers ?? []).filter((entry) => entry.status !== "ok" && !entry.status.startsWith("skipped_")),
  ),
}));

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { loadSyncErrors } from "./core/errors.js";
import { loadMcpHealthSnapshot } from "./mcp/health-snapshot.js";
import { loadState } from "./state.js";
import { collectStatusData, getSourcesFreshness, status } from "./status.js";
import { probeAutoRepairHealth } from "./sync/auto-repair-health.js";
import { loadInstructions } from "./sync/instructions-sync.js";
import { getSkillSources } from "./sync/skills-sync.js";
import type { Source } from "./types.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockLoadState = vi.mocked(loadState);
const mockGetSkillSources = vi.mocked(getSkillSources);
const mockLoadInstructions = vi.mocked(loadInstructions);
const mockLoadSyncErrors = vi.mocked(loadSyncErrors);
const mockProbeAutoRepairHealth = vi.mocked(probeAutoRepairHealth);
const mockLoadMcpHealthSnapshot = vi.mocked(loadMcpHealthSnapshot);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("status", () => {
  it("returns early when not initialized", async () => {
    mockLoadState.mockReturnValue(undefined);
    await status({ verbose: true });
  });

  it("shows agents, servers, and sources", async () => {
    mockLoadState.mockReturnValue({
      agents: [
        { name: "claude-code", detected: true, skillsDir: "x" },
        { name: "cursor", detected: false, skillsDir: "y" },
      ],
      sources: [
        { url: "user/repo", type: "github", skillsInstalled: ["a"], availableItems: [], addedAt: "2026-01-01" },
      ],
      mcpServers: [
        { name: "pg", command: "npx", args: [], env: {}, source: "catalog" },
        { name: "ent", command: "npx", args: [], env: {}, source: "user" },
      ],
      catalogVersion: "0.1.0",
    });
    await status({ verbose: true });
    expect(console.log).toHaveBeenCalled();
  });

  it("shows (none) when no servers or sources", async () => {
    mockLoadState.mockReturnValue({
      agents: [{ name: "claude-code", detected: true, skillsDir: "x" }],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    await status({ verbose: true });
    expect(console.log).toHaveBeenCalledWith("  (none)");
  });

  it("shows unresolved MCP health failures from the auto-heal snapshot", async () => {
    mockLoadState.mockReturnValue({
      agents: [{ name: "cursor", detected: true, skillsDir: "x" }],
      sources: [],
      mcpServers: [{ name: "github", command: "npx", args: [], env: {}, source: "catalog" }],
      catalogVersion: "0.1.0",
    });
    mockLoadMcpHealthSnapshot.mockReturnValue({
      generatedAt: new Date().toISOString(),
      servers: [
        {
          name: "github",
          agent: "cursor",
          status: "smoke_call_failed",
          lastCheckedAt: new Date().toISOString(),
          lastError: "401 Unauthorized",
          healHistory: [],
        },
      ],
    });

    await status();

    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(calls).toContain("MCP Health");
    expect(calls).toContain("1 failing");
    expect(calls).toContain("github/cursor");
    expect(calls).toContain("unhealthy for");
  });
});

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    url: "test/repo",
    type: "github",
    skillsInstalled: [],
    availableItems: [],
    addedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("status skills section", () => {
  it("shows skills count from sources", async () => {
    mockLoadState.mockReturnValue({
      agents: [{ name: "claude-code", detected: true, skillsDir: "x" }],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    mockGetSkillSources.mockReturnValue([
      { label: "dev-skills", path: "/skills", scanner: () => ["/skills/commit", "/skills/debug", "/skills/review"] },
    ]);
    await status({ verbose: true });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Skills"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("3"));
  });

  it("shows (none) when no skills found", async () => {
    mockLoadState.mockReturnValue({
      agents: [{ name: "claude-code", detected: true, skillsDir: "x" }],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    mockGetSkillSources.mockReturnValue([]);
    await status({ verbose: true });
    // Should still work without errors
    expect(console.log).toHaveBeenCalled();
  });

  it("truncates long skill lists with +N more", async () => {
    mockLoadState.mockReturnValue({
      agents: [{ name: "claude-code", detected: true, skillsDir: "x" }],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    const manySkills = Array.from({ length: 10 }, (_, i) => `/skills/skill-${i}`);
    mockGetSkillSources.mockReturnValue([{ label: "dev", path: "/skills", scanner: () => manySkills }]);
    await status({ verbose: true });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("+5 more"));
  });

  // ── Cross-site count consistency (status-numbers-self-consistent) ──────────
  // The compact-status `Skills:` line MUST report the same count `agentbrew
  // sync` prints in its summary line and the same count the in-process
  // `collectSkills` helper produces. The historical "152 deployed from 9
  // sources" header (status) vs per-target skill totals in sync output was
  // counting different things under the same word — these tests pin the
  // canonical definition (unique skill names + sources contributing at least
  // one deduplicated skill) and assert all three sites agree.
  it("compact status reports unique skills 'in library across N sources' (matches collectSkills.size)", async () => {
    mockLoadState.mockReturnValue({
      agents: [{ name: "claude-code", detected: true, skillsDir: "x" }],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    mockGetSkillSources.mockReturnValue([
      {
        label: "catalog-installed",
        path: "/cat",
        scanner: () => ["/cat/commit", "/cat/debug", "/cat/review"],
      },
      { label: "user-source", path: "/user", scanner: () => ["/user/scout", "/user/triage"] },
    ]);
    await status();
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    // Deduped skill totals across sources — same wording sync would print.
    expect(calls).toContain("5 in library across 2 sources");
    // Old wording must be gone — it was the source of the 152-vs-125 confusion.
    expect(calls).not.toContain("deployed from");
  });

  it("status dedupes skills across sources (same name in two sources counts once)", async () => {
    mockLoadState.mockReturnValue({
      agents: [{ name: "claude-code", detected: true, skillsDir: "x" }],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    // Both sources expose `commit` and `debug` — the historical raw-sum count
    // was 4, but the canonical unique count (which sync uses) is 2.
    mockGetSkillSources.mockReturnValue([
      { label: "primary", path: "/a", scanner: () => ["/a/commit", "/a/debug"] },
      { label: "shadow", path: "/b", scanner: () => ["/b/commit", "/b/debug"] },
    ]);
    await status();
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    // 2 unique names — only first-source-wins entries counted; second source
    // contributes 0 (so "1 source" not "2 sources" — matches sync's per-source
    // breakdown which would show `2 from primary`, no `shadow` row).
    expect(calls).toContain("2 in library across 1 sources");
  });

  it("status agrees with collectSkills on count and source-with-skills tally", async () => {
    // This test pins the contract directly via collectSkills — if a future
    // refactor changes either function's dedup model without touching the
    // other, this fails before users see the inconsistency in the wild.
    const { collectSkills } = await import("./sync/skills-sync.js");
    const scannedSources = [
      {
        label: "catalog-installed",
        skillPaths: ["/cat/commit", "/cat/debug", "/cat/review", "/cat/scout"],
      },
      { label: "user-skills", skillPaths: ["/user/triage", "/user/lint"] },
      { label: "duplicate", skillPaths: ["/dup/commit"] }, // overlaps catalog-installed → contributes 0
    ];
    const { skills, bySource } = collectSkills(scannedSources);
    expect(skills.size).toBe(6);
    expect(Object.keys(bySource).length).toBe(2); // duplicate source contributes 0 → not in bySource

    // Now drive the same scenario through status and confirm the displayed
    // count matches.
    mockLoadState.mockReturnValue({
      agents: [{ name: "claude-code", detected: true, skillsDir: "x" }],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    mockGetSkillSources.mockReturnValue(
      scannedSources.map((s) => ({
        label: s.label,
        path: `/${s.label}`,
        scanner: () => s.skillPaths,
      })),
    );
    await status();
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(calls).toContain(`${skills.size} in library across ${Object.keys(bySource).length} sources`);
  });
});

describe("status commands section", () => {
  function makeBasicState() {
    return {
      agents: [{ name: "claude-code", detected: true, skillsDir: "x" }],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    };
  }

  it("shows commands count when commands dir exists", async () => {
    mockLoadState.mockReturnValue(makeBasicState());
    mockExistsSync.mockImplementation((p) => {
      if (String(p).includes("agentbrew/commands")) return true;
      return false;
    });
    mockReaddirSync.mockImplementation(((p: string) => {
      if (String(p).includes("agentbrew/commands")) return ["deploy.md", "test.md"];
      return [];
    }) as unknown as typeof readdirSync);

    await status({ verbose: true });
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("Commands");
    expect(calls).toContain("2");
  });

  it("skips commands section when no commands dir", async () => {
    mockLoadState.mockReturnValue(makeBasicState());
    mockExistsSync.mockReturnValue(false);

    await status({ verbose: true });
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).not.toContain("Commands");
  });
});

describe("status instructions section", () => {
  function makeBasicState() {
    return {
      agents: [{ name: "claude-code", detected: true, skillsDir: "x" }],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    };
  }

  it("shows instructions status when source exists", async () => {
    mockLoadState.mockReturnValue(makeBasicState());
    mockLoadInstructions.mockReturnValue("# AGENTS.md");
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("# AGENTS.md");

    await status({ verbose: true });
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("Instructions");
    expect(calls).toContain("up to date");
  });

  it("shows out of date when content differs", async () => {
    mockLoadState.mockReturnValue(makeBasicState());
    mockLoadInstructions.mockReturnValue("# New AGENTS.md");
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("# Old content");

    await status({ verbose: true });
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("out of date");
  });

  it("shows not deployed when target missing", async () => {
    mockLoadState.mockReturnValue(makeBasicState());
    mockLoadInstructions.mockReturnValue("# AGENTS.md");
    mockExistsSync.mockReturnValue(false);

    await status({ verbose: true });
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("not deployed");
  });

  it("reports up to date when deployed wraps template in markers (uses isInstructionsUpToDate)", async () => {
    // Real deployed files wrap the template in <!-- agentbrew:instructions:start --> markers and
    // append a managed rules section. A raw `deployed === content` check always sees these as
    // out-of-date; the status must use isInstructionsUpToDate so marker-wrapped + trailing user
    // content does not flag false-positive drift.
    mockLoadState.mockReturnValue(makeBasicState());
    mockLoadInstructions.mockReturnValue("# AGENTS.md\n\n## Body\ntemplate body");
    mockExistsSync.mockReturnValue(true);
    // Deployed file: template at start, followed by user content and managed rules block.
    // The mocked isInstructionsUpToDate returns true when deployed starts with content.trimEnd().
    mockReadFileSync.mockReturnValue(
      [
        "# AGENTS.md",
        "",
        "## Body",
        "template body",
        "",
        "<!-- agentbrew:start -->",
        "managed rules",
        "<!-- agentbrew:end -->",
      ].join("\n"),
    );

    await status({ verbose: true });
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("up to date");
    expect(calls).not.toContain("out of date");
  });

  it("skips instructions section when no source", async () => {
    mockLoadState.mockReturnValue(makeBasicState());
    mockLoadInstructions.mockReturnValue(undefined);
    mockExistsSync.mockReturnValue(false);

    await status({ verbose: true });
    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).not.toContain("Instructions");
  });
});

describe("status --json", () => {
  it("outputs valid JSON when json option is true", async () => {
    mockLoadState.mockReturnValue({
      agents: [
        { name: "claude-code", detected: true, skillsDir: "x" },
        { name: "cursor", detected: false, skillsDir: "y" },
      ],
      sources: [
        {
          url: "user/repo",
          type: "github",
          skillsInstalled: ["a"],
          availableItems: [
            { name: "a", description: "", type: "skill" as const },
            { name: "b", description: "", type: "skill" as const },
          ],
          addedAt: "2026-01-01",
        },
      ],
      mcpServers: [{ name: "pg", command: "npx", args: [], env: {}, source: "catalog" }],
      catalogVersion: "0.1.0",
    });
    await status({ json: true });
    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const data = JSON.parse(output);
    expect(data.agents).toHaveLength(2);
    expect(data.agents[0].detected).toBe(true);
    expect(data.mcpServers).toHaveLength(1);
    expect(data.sources[0].installed).toBe(1);
    expect(data.sources[0].available).toBe(2);
    expect(data.statePath).toBe("/mock/.config/agentbrew/state.yaml");
  });

  it("returns undefined from collectStatusData when not initialized", () => {
    mockLoadState.mockReturnValue(undefined);
    expect(collectStatusData()).toBeUndefined();
  });
});

describe("getSourcesFreshness", () => {
  it("returns undefined for empty sources", () => {
    expect(getSourcesFreshness([])).toBeUndefined();
  });

  it("returns 'never fetched' when sources exist but none indexed", () => {
    expect(getSourcesFreshness([makeSource()])).toBe("never fetched");
  });

  it("returns 'fetched just now' for very recent index", () => {
    const source = makeSource({ indexedAt: new Date().toISOString() });
    expect(getSourcesFreshness([source])).toBe("fetched just now");
  });

  it("returns hours ago for older index", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const source = makeSource({ indexedAt: twoHoursAgo });
    expect(getSourcesFreshness([source])).toBe("fetched 2h ago");
  });

  it("returns days ago for old index", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const source = makeSource({ indexedAt: threeDaysAgo });
    expect(getSourcesFreshness([source])).toBe("fetched 3d ago");
  });

  it("uses most recent indexedAt across multiple sources", () => {
    const old = makeSource({
      url: "old/repo",
      indexedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const recent = makeSource({ url: "new/repo", indexedAt: new Date().toISOString() });
    expect(getSourcesFreshness([old, recent])).toBe("fetched just now");
  });
});

describe("status sync errors section", () => {
  beforeEach(() => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(false);
  });

  it("shows sync errors when errors exist", async () => {
    mockLoadSyncErrors.mockReturnValue({
      lastSyncAt: new Date().toISOString(),
      errors: [
        { module: "mcp-sync", message: "failed to write config", timestamp: new Date().toISOString(), code: "ERR" },
        { module: "skills-sync", message: "permission denied", timestamp: new Date().toISOString(), code: "ERR" },
      ],
    });

    await status({ verbose: true });

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("Sync Errors");
    expect(calls).toContain("failed to write config");
  });

  it("shows last sync info with no errors when error log is clean", async () => {
    mockLoadSyncErrors.mockReturnValue({
      lastSyncAt: new Date().toISOString(),
      errors: [],
    });

    await status({ verbose: true });

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("Last Sync");
    expect(calls).toContain("no errors");
  });

  it("shows drift repair active only when the scheduler ran recently", async () => {
    mockLoadSyncErrors.mockReturnValue(undefined);
    mockProbeAutoRepairHealth.mockReturnValue({
      backend: "launchagent",
      state: "active",
      loaded: true,
      lastRunAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    });

    await status({ verbose: true });

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("Drift Repair");
    expect(calls).toContain("✓ active");
    expect(calls).toContain("last ran 5m ago");
  });

  it.each([
    ["verbose", { verbose: true }],
    ["compact", {}],
  ])("does not claim auto-repair is active when the LaunchAgent is not loaded (%s)", async (_label, options) => {
    mockLoadState.mockReturnValue({ agents: [], sources: [], mcpServers: [], catalogVersion: "0.1.0" });
    mockLoadSyncErrors.mockReturnValue(undefined);
    mockProbeAutoRepairHealth.mockReturnValue({ backend: "launchagent", state: "not-loaded", loaded: false });

    await status(options);

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("not running");
    expect(calls).toContain("agentbrew auto-sync install");
    expect(calls).not.toMatch(/Auto-repair:\s+\S*active|✓ active/u);
  });
});

describe("status instructions catch branch", () => {
  it("counts not deployed when readFileSync throws for a target", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    mockLoadInstructions.mockReturnValue("# Instructions content");
    mockExistsSync.mockImplementation((path) => {
      // Return true for the target rulesFile so the code tries to read it
      return typeof path === "string" && path.includes("mock-target");
    });
    mockReadFileSync.mockImplementation(() => {
      throw new Error("permission denied");
    });

    await status({ verbose: true });
    // Should not throw — the catch branch counts as notDeployed
  });
});

describe("status collectStatusData with sync errors", () => {
  it("includes syncErrors in status data when errors exist", () => {
    mockLoadState.mockReturnValue({
      agents: [{ name: "claude-code", detected: true, skillsDir: "x" }],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    mockLoadSyncErrors.mockReturnValue({
      lastSyncAt: new Date().toISOString(),
      errors: [{ module: "mcp-sync", message: "oops", timestamp: new Date().toISOString(), code: "ERR" }],
    });

    const data = collectStatusData();

    expect(data?.syncErrors).toHaveLength(1);
    expect(data?.syncErrors?.[0].message).toBe("oops");
  });
});

describe("status collectStatusData instructions readFileSync catch branch (line 92)", () => {
  it("counts notDeployed when readFileSync throws for a deployed target path", () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    mockLoadInstructions.mockReturnValue("# source content");
    // Return true so the code enters the read branch (not the notDeployed++ continue path)
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error("permission denied");
    });

    const data = collectStatusData();

    // notDeployed should be positive — the catch branch incremented it
    expect(data?.instructions?.notDeployed).toBeGreaterThan(0);
  });

  it("counts outOfDate when readFileSync returns content different from source", () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    mockLoadInstructions.mockReturnValue("# new content");
    // Return true so the code enters the read branch
    mockExistsSync.mockReturnValue(true);
    // Return stale content so deployed !== content triggers outOfDate++
    mockReadFileSync.mockReturnValue("# old content");

    const data = collectStatusData();

    expect(data?.instructions?.outOfDate).toBeGreaterThan(0);
  });
});

describe("status commands (none) path (line 207)", () => {
  it("logs (none) when commands dir exists but contains no .md files", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockImplementation((path) => String(path).includes("agentbrew/commands"));
    // Return only non-.md files so commandFiles is empty
    mockReaddirSync.mockImplementation((() => ["README.txt", "config.yaml"]) as unknown as typeof readdirSync);

    await status({ verbose: true });

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("(none)");
  });
});

describe("status instructions readFileSync catch branch in status() (line 236)", () => {
  it("counts notDeployed when readFileSync throws inside status() instructions loop", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    mockLoadInstructions.mockReturnValue("# Instructions content");
    // Return true so the code enters the try-read branch instead of the notDeployed++ continue path
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error("permission denied");
    });

    await status({ verbose: true });

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    // The catch increments notDeployed — the summary line should contain "not deployed"
    expect(calls).toContain("not deployed");
  });
});

describe("status sync errors overflow path (line 262)", () => {
  it("logs '... and N more' when more than 10 sync errors exist", async () => {
    mockLoadState.mockReturnValue({
      agents: [],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(false);

    const manyErrors = Array.from({ length: 12 }, (_, index) => ({
      module: "mcp-sync",
      message: `error ${index}`,
      timestamp: new Date().toISOString(),
      code: "ERR",
    }));
    mockLoadSyncErrors.mockReturnValue({
      lastSyncAt: new Date().toISOString(),
      errors: manyErrors,
    });

    await status({ verbose: true });

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("... and 2 more");
  });

  it("shows no-Agentfile hint when no project Agentfile exists", async () => {
    mockLoadState.mockReturnValue({
      agents: [{ name: "claude-code", detected: true, skillsDir: "x" }],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockReturnValue(false);

    await status();

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("no Agentfile");
    expect(calls).toContain("agentfile-init");
  });

  it("shows global Agentfile path when it exists", async () => {
    mockLoadState.mockReturnValue({
      agents: [{ name: "claude-code", detected: true, skillsDir: "x" }],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    mockExistsSync.mockImplementation((p) => String(p).includes("Agentfile.yaml") && String(p).includes(".config"));

    await status();

    const calls = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(calls).toContain("Agentfile:");
    expect(calls).toContain("(global)");
  });

  it("shows 'no errors' on the Last Sync line when error log exists with no errors", async () => {
    // Sub-issue 1 of `sync-idempotent-and-complete`: the compact line used to
    // say "clean" which made users conflate "the sync command exited 0" with
    // "no problems remain on this machine". The Drift line right below could
    // legitimately report N issues at the same time. "no errors" matches
    // what's actually being measured (the saved error log) and mirrors the
    // verbose-mode wording, so the user no longer reads them as contradictory.
    mockLoadState.mockReturnValue({
      agents: [{ name: "claude-code", detected: true, skillsDir: "x" }],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    mockLoadSyncErrors.mockReturnValue({
      lastSyncAt: new Date().toISOString(),
      errors: [],
    });

    await status();

    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(calls).toContain("Last Sync");
    expect(calls).toContain("no errors");
    // Old wording must be gone — it implied "clean = no problems" which the
    // Drift line on the same screen often contradicts.
    expect(calls).not.toMatch(/Last Sync:\s+\S*\s*clean\b/);
  });

  it("shows error count when sync errors exist", async () => {
    mockLoadState.mockReturnValue({
      agents: [{ name: "claude-code", detected: true, skillsDir: "x" }],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    mockLoadSyncErrors.mockReturnValue({
      lastSyncAt: new Date().toISOString(),
      errors: [{ message: "write failed", module: "mcp-sync", timestamp: new Date().toISOString(), code: "EACCES" }],
    });

    await status();

    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(calls).toContain("1 error(s)");
  });
});

describe("status — unconfigured agents hint", () => {
  it("shows hint in compact mode when detected agent has missing config", async () => {
    mockLoadState.mockReturnValue({
      agents: [
        { name: "claude-code", detected: true, skillsDir: "~/.claude/skills", mcpConfig: "~/.claude.json" },
        {
          name: "windsurf",
          detected: true,
          skillsDir: "~/.codeium/windsurf/skills",
          mcpConfig: "~/.codeium/windsurf/mcp_config.json",
        },
      ],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    // existsSync defaults to false — all config files "missing"

    await status();

    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(calls).toContain("Needs setup");
    expect(calls).toContain("open the app once");
  });

  it("shows hint in verbose mode with per-agent config paths", async () => {
    mockLoadState.mockReturnValue({
      agents: [{ name: "cursor", detected: true, skillsDir: "~/.cursor/skills", mcpConfig: "~/.cursor/mcp.json" }],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });

    await status({ verbose: true });

    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(calls).toContain("Needs setup");
    expect(calls).toContain("cursor");
  });

  it("does not show hint when all config files exist", async () => {
    mockLoadState.mockReturnValue({
      agents: [{ name: "claude-code", detected: true, skillsDir: "~/.claude/skills", mcpConfig: "~/.claude.json" }],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });
    // Make all existsSync calls return true
    mockExistsSync.mockReturnValue(true);

    await status();

    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(calls).not.toContain("Needs setup");
  });

  it("does not show hint for agents without mcpConfig defined", async () => {
    mockLoadState.mockReturnValue({
      agents: [{ name: "augment", detected: true, skillsDir: "~/.augment/skills" }],
      sources: [],
      mcpServers: [],
      catalogVersion: "0.1.0",
    });

    await status();

    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(calls).not.toContain("Needs setup");
  });
});
