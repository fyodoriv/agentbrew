import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  copyFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("./state.js", () => {
  const loadState = vi.fn();
  return { loadState, requireState: loadState, saveState: vi.fn() };
});

vi.mock("./catalog/index-source.js", () => ({
  indexSource: vi.fn(() => []),
  getSourceCachePath: vi.fn(() => undefined),
  formatItemCounts: vi.fn((items: Array<{ type: string }>) => `${items.length} items`),
}));

vi.mock("./sync/mcp-sync.js", () => ({
  addMcpServer: vi.fn(),
}));

vi.mock("./sync/rules-sync.js", () => ({
  loadSharedRules: vi.fn(() => undefined),
  saveSharedRules: vi.fn(),
}));

vi.mock("./utils.js", () => ({
  expandHome: vi.fn((path: string) => path.replace(/^~/, "/tmp/test-home")),
}));

vi.mock("./lock.js", () => ({
  lockSource: vi.fn(() => undefined),
}));

vi.mock("./skills/skill-versions.js", () => ({
  recordSourceSha: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { getSourceCachePath, indexSource } from "./catalog/index-source.js";
import { loadState, saveState } from "./state.js";
import { addMcpServer } from "./sync/mcp-sync.js";
import { loadSharedRules, saveSharedRules } from "./sync/rules-sync.js";

const mockIndexSource = vi.mocked(indexSource);
const mockGetSourceCachePath = vi.mocked(getSourceCachePath);

import { addSource, detectSourceType, listSourceItems, removeSource } from "./add-source.js";

const mockExistsSync = vi.mocked(existsSync);
const mockExecFileSync = vi.mocked(execFileSync);
const mockLoadState = vi.mocked(loadState);
const mockSaveState = vi.mocked(saveState);
const mockReadFileSync = vi.mocked(readFileSync);
const mockCopyFileSync = vi.mocked(copyFileSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockAddMcpServer = vi.mocked(addMcpServer);
const mockLoadSharedRules = vi.mocked(loadSharedRules);
const mockSaveSharedRules = vi.mocked(saveSharedRules);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("detectSourceType", () => {
  it("detects local paths starting with /", () => {
    expect(detectSourceType("/home/user/skills")).toBe("local");
  });

  it("detects local paths starting with ~", () => {
    expect(detectSourceType("~/my-skills")).toBe("local");
  });

  it("detects local paths starting with ./", () => {
    expect(detectSourceType("./skills")).toBe("local");
  });

  it("detects http URLs", () => {
    expect(detectSourceType("https://github.com/user/repo")).toBe("url");
  });

  it("detects git@ URLs", () => {
    expect(detectSourceType("git@github.com:user/repo.git")).toBe("url");
  });

  it("detects GitHub shorthand", () => {
    expect(detectSourceType("user/repo")).toBe("github");
    expect(detectSourceType("vercel-labs/skills")).toBe("github");
  });

  it("defaults to url for other formats", () => {
    expect(detectSourceType("something-else")).toBe("url");
  });
});

function makeState(detectedAgents: string[] = []) {
  return {
    agents: detectedAgents.map((name) => ({ name, detected: true, skillsDir: `~/.${name}/skills` })),
    sources: [] as Array<{
      url: string;
      type: "github" | "local" | "url";
      skillsInstalled: string[];
      availableItems: Array<{ name: string; description: string; type: "skill" }>;
      addedAt: string;
    }>,
    mcpServers: [],
    catalogVersion: "0.1.0",
  };
}

describe("addSource", () => {
  it("returns early when not initialized", async () => {
    mockLoadState.mockReturnValue(undefined);
    await addSource("user/repo", {});
    expect(mockSaveState).not.toHaveBeenCalled();
  });

  it("delegates to listSourceItems when --list", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockIndexSource.mockReturnValue([{ name: "s1", description: "desc", type: "skill" }]);
    await addSource("user/repo", { list: true });
    expect(mockIndexSource).toHaveBeenCalled();
  });

  it("rejects nonexistent local paths", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExistsSync.mockReturnValue(false);
    await addSource("/no/such/path", {});
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
  });

  it("adds new source to state on success", async () => {
    const state = makeState();
    mockLoadState.mockReturnValue(state);
    mockExecFileSync.mockReturnValue("" as never);
    await addSource("user/repo", {});
    expect(mockSaveState).toHaveBeenCalled();
    const saved = mockSaveState.mock.calls[0][0];
    expect(saved.sources).toHaveLength(1);
    expect((saved.sources ?? [])[0].url).toBe("user/repo");
    expect((saved.sources ?? [])[0].type).toBe("github");
    // User-invoked `agentbrew install` stamps origin: "user" so the team overlay
    // auto-register/auto-remove loop (run by `agentbrew team set <overlay-url>/off`) will
    // leave this source alone.
    expect((saved.sources ?? [])[0].origin).toBe("user");
  });

  it("stores bootstrap metadata discovered from a source manifest", async () => {
    const state = makeState();
    mockLoadState.mockReturnValue(state);
    mockExecFileSync.mockReturnValue("" as never);
    mockIndexSource.mockImplementation((source) => {
      source.bootstrapScript = "scripts/bootstrap.sh";
      return [{ name: "s1", description: "desc", type: "skill" }];
    });

    await addSource("user/repo", {});

    const saved = mockSaveState.mock.calls[0][0];
    expect((saved.sources ?? [])[0]).toMatchObject({ bootstrapScript: "scripts/bootstrap.sh" });
  });

  it("registers a bootstrap-only source even when no items are found", async () => {
    const state = makeState();
    mockLoadState.mockReturnValue(state);
    mockExecFileSync.mockReturnValue("" as never);
    mockIndexSource.mockImplementation((source) => {
      source.bootstrapScript = "scripts/bootstrap.sh";
      return [];
    });

    await addSource("user/repo", {});

    const saved = mockSaveState.mock.calls[0][0];
    expect((saved.sources ?? [])[0]).toMatchObject({ url: "user/repo", bootstrapScript: "scripts/bootstrap.sh" });
  });

  it("calls npx skills add when git clone finds no items", async () => {
    const state = makeState();
    mockLoadState.mockReturnValue(state);
    mockExecFileSync.mockReturnValue("" as never);
    mockIndexSource.mockReturnValue([]); // clone finds nothing
    await addSource("user/repo", {});
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "npx",
      expect.arrayContaining(["skills", "add", "user/repo"]),
      expect.any(Object),
    );
  });

  describe("delegateRemoteSkill per-agent dispatch (slice 3)", () => {
    beforeEach(() => {
      mockExecFileSync.mockReturnValue("" as never);
      mockIndexSource.mockReturnValue([]); // force fallback to delegate path
    });

    it("falls back to --agent * when state.agents is empty (pre-init)", async () => {
      // First-run before `agentbrew init` populates state.agents — the
      // dispatcher must still produce a working subprocess invocation,
      // so we keep the historical wildcard fallback. Without this carve-
      // out a fresh user would see a confusing "no agents detected" skip
      // before they've had a chance to run init.
      mockLoadState.mockReturnValue(makeState([]));
      await addSource("user/repo", {});
      const args = mockExecFileSync.mock.calls[0]?.[1] as string[];
      expect(args).toContain("*");
      // Wildcard form: exactly one --agent flag pointing at "*".
      const agentFlags = args.filter((a) => a === "--agent");
      expect(agentFlags).toHaveLength(1);
    });

    it("emits one --agent <name> pair per detected intersection agent", async () => {
      mockLoadState.mockReturnValue(makeState(["claude-code", "cursor", "windsurf"]));
      await addSource("user/repo", {});
      const args = mockExecFileSync.mock.calls[0]?.[1] as string[];
      // No wildcard — explicit per-agent dispatch.
      expect(args).not.toContain("*");
      expect(args).toEqual(
        expect.arrayContaining(["--agent", "claude-code", "--agent", "cursor", "--agent", "windsurf"]),
      );
    });

    it("translates rename pairs at the subprocess boundary (copilot → github-copilot, kiro → kiro-cli, roo-code → roo)", async () => {
      mockLoadState.mockReturnValue(makeState(["copilot", "kiro", "roo-code"]));
      await addSource("user/repo", {});
      const args = mockExecFileSync.mock.calls[0]?.[1] as string[];
      // AGENTBREW_TO_SKILLS_CLI renames translate; agentbrew names never appear in the args.
      expect(args).toEqual(
        expect.arrayContaining(["--agent", "github-copilot", "--agent", "kiro-cli", "--agent", "roo"]),
      );
      expect(args).not.toContain("copilot");
      expect(args).not.toContain("kiro");
      expect(args).not.toContain("roo-code");
    });

    it("filters carve-outs (claude-desktop, qodo) and warns", async () => {
      const consoleSpy = vi.spyOn(console, "log");
      mockLoadState.mockReturnValue(makeState(["claude-code", "claude-desktop", "devin", "cursor", "qodo"]));
      await addSource("user/repo", {});
      const args = mockExecFileSync.mock.calls[0]?.[1] as string[];
      // Carve-outs must NOT appear in the subprocess args — they have no
      // skills CLI equivalent and must stay on the native installer path.
      expect(args).not.toContain("claude-desktop");
      expect(args).not.toContain("qodo");
      // Intersection agents survive.
      expect(args).toEqual(expect.arrayContaining(["--agent", "claude-code", "--agent", "devin", "--agent", "cursor"]));
      // User-visible carve-out warning so they understand which agents are
      // not covered by the delegated install.
      const warningCall = consoleSpy.mock.calls.find((call) => {
        const msg = String(call[0] ?? "");
        return msg.includes("not supported by skills CLI");
      });
      expect(warningCall).toBeDefined();
      const warningMsg = String(warningCall?.[0] ?? "");
      expect(warningMsg).toContain("claude-desktop");
      expect(warningMsg).toContain("qodo");
    });

    it("skips skills CLI invocation when only carve-outs are detected", async () => {
      // If every detected agent is a carve-out, there is nothing for skills
      // CLI to do — running `npx skills add ... --global` with no `--agent`
      // flags would fall back to skills CLI's own auto-detection and
      // contradict agentbrew's detection set. We refuse the subprocess and
      // surface a one-line skip note instead.
      mockLoadState.mockReturnValue(makeState(["claude-desktop", "qodo"]));
      await addSource("user/repo", {});
      expect(mockExecFileSync).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Skipping skills CLI delegation"));
    });

    it("surfaces per-carve-out rationale bullets after the one-line warning (surface-carveout-rationale-in-cli-warning)", async () => {
      // Surface-carveout-rationale-in-cli-warning (TASKS.md P2): the
      // existing one-line warning ("Note: claude-desktop is not supported
      // by skills CLI; install via native path.") is too terse — users
      // don't know WHY skills CLI doesn't target the agent. Now that
      // `AGENTBREW_ONLY_AGENTS_RATIONALE` (slice 6 of
      // `delegate-skill-install-to-skills-cli`) is programmatically
      // accessible, print one bullet per carve-out with its per-agent
      // reason. This test pins the bullet format so a future test-rewrite
      // can't silently drop them.
      const consoleSpy = vi.spyOn(console, "log");
      mockLoadState.mockReturnValue(makeState(["claude-code", "claude-desktop", "qodo", "cursor"]));
      await addSource("user/repo", {});
      const allCalls = consoleSpy.mock.calls.map((call) => String(call[0] ?? ""));
      // The one-line summary still fires (existing behavior — pinned by
      // the sibling test above; re-asserted here so the order is clear).
      const summary = allCalls.find((m) => m.includes("not supported by skills CLI"));
      expect(summary).toBeDefined();
      // Per-agent bullets follow. The bullet character + "<agent>:"
      // pattern is the format users will see; downstream tests can rely
      // on that shape.
      const desktopBullet = allCalls.find((m) => m.includes("• claude-desktop:") && m.includes("readsFrom"));
      expect(desktopBullet, "claude-desktop bullet must include its rationale").toBeDefined();
      const qodoBullet = allCalls.find((m) => m.includes("• qodo:") && m.includes("not yet present"));
      expect(qodoBullet, "qodo bullet must include its rationale").toBeDefined();
    });
  });

  describe("skills CLI delegation for skill-shaped sources (slice 5)", () => {
    // Slice 5 of `delegate-skill-install-to-skills-cli`: for skill-shaped
    // remote sources, agentbrew runs `npx skills add ... --agent <name> ...`
    // BEFORE the native registration so all detected intersection agents'
    // skills directories are populated by skills CLI. Carve-out agents
    // (`claude-desktop`, `overlay-desktop`) STAY on the native path — skills
    // CLI doesn't target them. Slice 4 (PR #804) shipped this gate as a
    // `claude-code`-only canary; slice 5 broadens to the full supported
    // intersection.
    beforeEach(() => {
      mockExecFileSync.mockReturnValue("" as never);
    });

    it("delegates to all detected intersection agents when source is skill-shaped", async () => {
      mockLoadState.mockReturnValue(makeState(["claude-code", "cursor", "windsurf"]));
      // Skill-shaped: indexSource finds at least one SKILL.md.
      mockIndexSource.mockReturnValue([{ name: "my-skill", description: "desc", type: "skill" }]);
      await addSource("user/repo", {});

      // Slice 5 broadens the canary: every detected intersection agent
      // appears as a `--agent <name>` pair in the subprocess args.
      const delegationArgs = mockExecFileSync.mock.calls[0]?.[1] as string[];
      expect(delegationArgs).toEqual(
        expect.arrayContaining(["--agent", "claude-code", "--agent", "cursor", "--agent", "windsurf"]),
      );
      // Multiple `--agent` flags emitted (one per detected intersection agent).
      const agentFlags = delegationArgs.filter((a) => a === "--agent");
      expect(agentFlags).toHaveLength(3);
    });

    it("filters carve-outs from the delegation but still triggers when intersection agents exist", async () => {
      // claude-desktop and qodo are carve-outs; claude-code,
      // devin, and cursor are intersection agents. Delegation triggers (because
      // the intersection set is non-empty) but the carve-outs are filtered
      // by buildSkillsCliAgentArgs at the subprocess boundary. Carve-outs
      // are then deployed natively by agentbrew's sync engine.
      mockLoadState.mockReturnValue(makeState(["claude-code", "claude-desktop", "devin", "cursor", "qodo"]));
      mockIndexSource.mockReturnValue([{ name: "my-skill", description: "desc", type: "skill" }]);
      await addSource("user/repo", {});

      const delegationArgs = mockExecFileSync.mock.calls[0]?.[1] as string[];
      // Intersection agents survive.
      expect(delegationArgs).toEqual(
        expect.arrayContaining(["--agent", "claude-code", "--agent", "devin", "--agent", "cursor"]),
      );
      // Carve-outs do NOT appear in the subprocess args.
      expect(delegationArgs).not.toContain("claude-desktop");
      expect(delegationArgs).not.toContain("qodo");
    });

    it("does NOT delegate when source has no skills (non-skill source)", async () => {
      mockLoadState.mockReturnValue(makeState(["claude-code", "cursor"]));
      // Non-skill source: only rules / commands / mcp, no SKILL.md.
      mockIndexSource.mockReturnValue([{ name: "my-rule", description: "desc", type: "rule" }]);
      await addSource("user/repo", {});

      // No subprocess call: native registration handles the rule alone.
      expect(mockExecFileSync).not.toHaveBeenCalled();
    });

    it("does NOT delegate when only carve-out agents are detected (no intersection)", async () => {
      // Slice 5 short-circuits when every detected agent is a carve-out —
      // skills CLI would emit zero `--agent` flags and refuse the subprocess.
      // The native installer handles claude-desktop / qodo
      // anyway (they're agentbrew-only by definition).
      mockLoadState.mockReturnValue(makeState(["claude-desktop", "qodo"]));
      mockIndexSource.mockReturnValue([{ name: "my-skill", description: "desc", type: "skill" }]);
      await addSource("user/repo", {});

      expect(mockExecFileSync).not.toHaveBeenCalled();
    });

    it("delegates when only Devin is detected because skills CLI now supports it", async () => {
      mockLoadState.mockReturnValue(makeState(["devin"]));
      mockIndexSource.mockReturnValue([{ name: "my-skill", description: "desc", type: "skill" }]);
      await addSource("user/repo", {});

      const delegationArgs = mockExecFileSync.mock.calls[0]?.[1] as string[];
      expect(delegationArgs).toEqual(expect.arrayContaining(["--agent", "devin"]));
    });

    it("does NOT delegate when skillInstallMode is 'native'", async () => {
      // User opt-out for offline / proxy environments where `npx skills add`
      // is unreliable. The mode field on state.yaml must defeat the
      // delegation regardless of how many intersection agents are detected.
      const state = makeState(["claude-code", "cursor"]);
      (state as { skillInstallMode?: "native" | "auto" | "delegate" }).skillInstallMode = "native";
      mockLoadState.mockReturnValue(state);
      mockIndexSource.mockReturnValue([{ name: "my-skill", description: "desc", type: "skill" }]);
      await addSource("user/repo", {});

      expect(mockExecFileSync).not.toHaveBeenCalled();
    });

    it("delegates when skillInstallMode is 'delegate' (explicit opt-in)", async () => {
      const state = makeState(["claude-code", "cursor"]);
      (state as { skillInstallMode?: "native" | "auto" | "delegate" }).skillInstallMode = "delegate";
      mockLoadState.mockReturnValue(state);
      mockIndexSource.mockReturnValue([{ name: "my-skill", description: "desc", type: "skill" }]);
      await addSource("user/repo", {});

      const delegationArgs = mockExecFileSync.mock.calls[0]?.[1] as string[];
      expect(delegationArgs).toEqual(expect.arrayContaining(["--agent", "claude-code", "--agent", "cursor"]));
    });

    it("falls back to native when delegation subprocess fails", async () => {
      // Delegation failure must not abort the native registration — the
      // intersection agents will be deployed via agentbrew's own scan.
      mockLoadState.mockReturnValue(makeState(["claude-code", "cursor"]));
      mockIndexSource.mockReturnValue([{ name: "my-skill", description: "desc", type: "skill" }]);
      mockExecFileSync.mockImplementation(() => {
        throw new Error("network error");
      });
      await addSource("user/repo", {});

      // Native registration still ran (state was saved).
      expect(mockSaveState).toHaveBeenCalled();
    });

    it("points delegated install failures at networking and offline-cache troubleshooting", async () => {
      mockLoadState.mockReturnValue(makeState(["claude-code", "cursor"]));
      mockIndexSource.mockReturnValue([{ name: "my-skill", description: "desc", type: "skill" }]);
      mockExecFileSync.mockImplementation(() => {
        throw new Error("ENOTCACHED");
      });

      await addSource("user/repo", {});

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Delegated skill install networking"));
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("npm/GitHub/skills.sh"));
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("offline-cache"));
    });

    // ── Per-failure-mode fallback matrix (P2 skill-install-fallback-docs-and-tests) ─
    //
    // The 4 failure modes named in the task body — each maps to a distinct
    // error shape `npx skills add` can throw under corporate-network / offline
    // conditions. The matrix asserts (a) the fallback path runs (state saved
    // → native scanner takes over) and (b) the error surface mentions the
    // troubleshooting hint so users in that exact failure mode know what to do.
    //
    // Anchored to the README "Delegated skill install networking" section
    // (lines 54-60) so the doc-and-code surface stay aligned. If the README
    // adds a new explicit failure mode, add a row here.
    describe.each([
      {
        scenario: "proxy block (HTTP 407 / blocked-by-proxy)",
        error: new Error("AggregateError [E407]: tunneling socket could not be established, statusCode=407"),
      },
      {
        scenario: "network timeout (ETIMEDOUT)",
        error: Object.assign(new Error("connect ETIMEDOUT 151.101.0.16:443"), { code: "ETIMEDOUT" }),
      },
      {
        scenario: "4xx HTTP error (404 / unauthorized package)",
        error: new Error("npm error 404 Not Found - GET https://registry.npmjs.org/right-hooks"),
      },
      {
        scenario: "registry unreachable (ENOTFOUND / ENOTCACHED / ECONNREFUSED)",
        error: Object.assign(new Error("getaddrinfo ENOTFOUND registry.npmjs.org"), { code: "ENOTFOUND" }),
      },
    ])("fallback failure-mode: $scenario", ({ error }) => {
      it("falls back to native AND emits the README-anchored troubleshooting hint", async () => {
        mockLoadState.mockReturnValue(makeState(["claude-code", "cursor"]));
        mockIndexSource.mockReturnValue([{ name: "my-skill", description: "desc", type: "skill" }]);
        mockExecFileSync.mockImplementation(() => {
          throw error;
        });

        await addSource("user/repo", {});

        // (a) native registration still ran (state was saved → fallback worked)
        expect(mockSaveState).toHaveBeenCalled();
        // (b) the user-visible error surface mentions the canonical hint
        //     so a user hitting this specific failure mode can find the fix
        //     in the README. The hint is the SKILLS_CLI_TROUBLESHOOTING_HINT
        //     constant — "Delegated skill install networking" is its anchor.
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Delegated skill install networking"));
      });
    });

    it("emits a one-line user-visible note when delegation triggers", async () => {
      const consoleSpy = vi.spyOn(console, "log");
      mockLoadState.mockReturnValue(makeState(["claude-code", "cursor"]));
      mockIndexSource.mockReturnValue([{ name: "my-skill", description: "desc", type: "skill" }]);
      await addSource("user/repo", {});

      const noteCall = consoleSpy.mock.calls.find((call) => {
        const msg = String(call[0] ?? "");
        return msg.includes("Skill-shaped source detected") && msg.includes("intersection agents");
      });
      expect(noteCall).toBeDefined();
    });

    it("delegates when source has .claude-plugin/marketplace.json even without SKILL.md items", async () => {
      // Anthropic plugin distribution shape: a `.claude-plugin/marketplace.json`
      // manifest at the repo root indexing skills programmatically (instead of
      // SKILL.md files at known paths). Skills CLI honors this format; the
      // delegation heuristic must too — otherwise plugin-shaped sources stay
      // on the native installer for the entire intersection, defeating the
      // slice.
      mockLoadState.mockReturnValue(makeState(["claude-code"]));
      // No skills found by the SKILL.md scanner; still triggers delegation
      // via the marketplace.json branch.
      mockIndexSource.mockReturnValue([{ name: "my-rule", description: "desc", type: "rule" }]);
      mockGetSourceCachePath.mockReturnValue("/cache/path");
      // existsSync returns true for the marketplace.json probe.
      mockExistsSync.mockImplementation((path: unknown) => {
        return typeof path === "string" && path.endsWith(".claude-plugin/marketplace.json");
      });
      await addSource("user/repo", {});

      const delegationArgs = mockExecFileSync.mock.calls[0]?.[1] as string[];
      expect(delegationArgs).toEqual(expect.arrayContaining(["--agent", "claude-code"]));
    });
  });

  it("does not call npx skills add for local sources", async () => {
    const state = makeState();
    mockLoadState.mockReturnValue(state);
    mockExistsSync.mockReturnValue(true);
    await addSource("/local/path", {});
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("does not SHA-lock remote sources", async () => {
    const state = makeState();
    mockLoadState.mockReturnValue(state);
    mockExecFileSync.mockReturnValue("" as never);
    const { recordSourceSha } = await import("./skills/skill-versions.js");
    vi.mocked(recordSourceSha).mockClear();
    await addSource("user/repo", {});
    expect(vi.mocked(recordSourceSha)).not.toHaveBeenCalled();
  });

  it("updates existing source timestamp", async () => {
    const state = makeState();
    state.sources.push({
      url: "user/repo",
      type: "github",
      skillsInstalled: [],
      availableItems: [],
      addedAt: "2025-01-01",
    });
    mockLoadState.mockReturnValue(state);
    mockExecFileSync.mockReturnValue("" as never);
    await addSource("user/repo", { skill: "new-skill" });
    expect(mockSaveState).toHaveBeenCalled();
    const saved = mockSaveState.mock.calls[0][0];
    expect(saved.sources).toHaveLength(1);
    expect((saved.sources ?? [])[0].skillsInstalled).toContain("new-skill");
  });

  it("handles clone and npx failure gracefully", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockIndexSource.mockReturnValue([]); // clone finds nothing
    mockExecFileSync.mockImplementation(() => {
      throw new Error("fail");
    });
    await addSource("user/repo", {});
    expect(mockSaveState).not.toHaveBeenCalled();
  });

  it("logs warning when cachePath unavailable for non-skill install", async () => {
    const state = makeState();
    mockLoadState.mockReturnValue(state);
    mockExecFileSync.mockReturnValue("" as never);
    mockGetSourceCachePath.mockReturnValue(undefined);
    await addSource("user/repo", { mcp: "my-server" });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Could not access source cache"));
  });

  describe("installMcpFromSource", () => {
    beforeEach(() => {
      mockLoadState.mockReturnValue(makeState());
      mockExecFileSync.mockReturnValue("" as never);
      mockGetSourceCachePath.mockReturnValue("/cache/path");
    });

    it("warns when mcp-servers.yaml is missing", async () => {
      mockExistsSync.mockReturnValue(false);
      await addSource("user/repo", { mcp: "my-server" });
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("No mcp-servers.yaml found"));
    });

    it("warns when server name not found in yaml", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("other-server:\n  command: node\n" as never);
      await addSource("user/repo", { mcp: "my-server" });
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("not found in source"));
    });

    it("installs MCP server when found in yaml", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("my-server:\n  command: node\n  args:\n    - server.js\n" as never);
      await addSource("user/repo", { mcp: "my-server" });
      expect(mockAddMcpServer).toHaveBeenCalledWith(
        "my-server",
        "node",
        ["server.js"],
        {},
        {
          url: undefined,
          headers: undefined,
        },
      );
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("MCP server 'my-server' installed"));
    });

    it("handles yaml parse errors gracefully", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("invalid: yaml: {{{" as never);
      // js-yaml throws on invalid YAML — the catch block should log an error
      await addSource("user/repo", { mcp: "my-server" });
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Failed to install MCP server"));
    });
  });

  describe("installRuleFromSource", () => {
    beforeEach(() => {
      mockLoadState.mockReturnValue(makeState());
      mockExecFileSync.mockReturnValue("" as never);
      mockGetSourceCachePath.mockReturnValue("/cache/path");
    });

    it("warns when rule file is missing", async () => {
      mockExistsSync.mockReturnValue(false);
      await addSource("user/repo", { rule: "my-rule" });
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("not found in source"));
    });

    it("warns when shared-rules.md does not exist", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("# My Rule\nsome content\n" as never);
      mockLoadSharedRules.mockReturnValue(undefined);
      await addSource("user/repo", { rule: "my-rule" });
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("agentbrew rules init"));
    });

    it("skips adding rule that already exists in shared-rules.md", async () => {
      mockExistsSync.mockReturnValue(true);
      const ruleContent = "# My Rule\nsome content";
      mockReadFileSync.mockReturnValue(ruleContent as never);
      mockLoadSharedRules.mockReturnValue(`existing content\n${ruleContent}\n`);
      await addSource("user/repo", { rule: "my-rule" });
      expect(mockSaveSharedRules).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("already present"));
    });

    it("appends rule to shared-rules.md", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("# New Rule\nrule content\n" as never);
      mockLoadSharedRules.mockReturnValue("# Existing rules\n");
      await addSource("user/repo", { rule: "my-rule" });
      expect(mockSaveSharedRules).toHaveBeenCalled();
      const savedContent = mockSaveSharedRules.mock.calls[0][0];
      expect(savedContent).toContain("<!-- rule: my-rule -->");
      expect(savedContent).toContain("# New Rule");
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("added to shared-rules.md"));
    });
  });

  describe("installCommandFromSource", () => {
    beforeEach(() => {
      mockLoadState.mockReturnValue(makeState());
      mockExecFileSync.mockReturnValue("" as never);
      mockGetSourceCachePath.mockReturnValue("/cache/path");
    });

    it("warns when command file is missing", async () => {
      mockExistsSync.mockReturnValue(false);
      await addSource("user/repo", { command: "my-command" });
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("not found in source"));
    });

    it("copies command file to target directory", async () => {
      mockExistsSync.mockReturnValue(true);
      mockMkdirSync.mockReturnValue(undefined as never);
      mockCopyFileSync.mockReturnValue(undefined);
      await addSource("user/repo", { command: "my-command" });
      expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining("commands"), { recursive: true });
      expect(mockCopyFileSync).toHaveBeenCalledWith(
        expect.stringContaining("my-command.md"),
        expect.stringContaining("my-command.md"),
      );
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("copied to commands/"));
    });
  });
});

describe("removeSource", () => {
  it("returns early when not initialized", async () => {
    mockLoadState.mockReturnValue(undefined);
    await removeSource("x");
    expect(mockSaveState).not.toHaveBeenCalled();
  });

  it("warns when source not found", async () => {
    mockLoadState.mockReturnValue(makeState());
    await removeSource("nonexistent");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
  });

  it("removes source from state", async () => {
    const state = makeState();
    state.sources.push({ url: "user/repo", type: "github", skillsInstalled: [], availableItems: [], addedAt: "" });
    mockLoadState.mockReturnValue(state);
    await removeSource("user/repo");
    expect(mockSaveState).toHaveBeenCalled();
    const saved = mockSaveState.mock.calls[0][0];
    expect(saved.sources).toHaveLength(0);
  });
});

describe("listSourceItems", () => {
  it("shows grouped items from source", async () => {
    mockIndexSource.mockReturnValue([
      { name: "my-skill", description: "A skill", type: "skill" },
      { name: "my-rule", description: "A rule", type: "rule" },
    ]);
    await listSourceItems("user/repo");
    expect(console.log).toHaveBeenCalled();
  });

  it("shows empty message when no items found", async () => {
    mockIndexSource.mockReturnValue([]);
    await listSourceItems("user/repo");
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("No items found"));
  });
});
