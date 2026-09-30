import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("write-file-atomic", () => ({
  sync: vi.fn(),
}));

vi.mock("./agentfile.js", () => ({
  loadAgentfile: vi.fn(),
  loadAgentfileFromPath: vi.fn(),
  resolveAgentfileMcp: vi.fn(() => []),
  validateAgentfileMcp: vi.fn(() => []),
  getStateServers: vi.fn(() => []),
  getStateSources: vi.fn(() => []),
}));

vi.mock("./catalog/types.js", () => ({
  loadCatalog: vi.fn(() => ({ skills: [], mcp_servers: [], rule_sets: [] })),
}));

vi.mock("./state.js", () => ({
  loadState: vi.fn(),
  saveState: vi.fn(),
}));

vi.mock("./paths.js", () => ({
  SHARED_RULES_PATH: "~/.config/agentbrew/shared-rules.md",
}));

vi.mock("./ui/output.js", () => ({
  ICON_SUCCESS: "✓",
}));

vi.mock("./utils.js", () => ({
  expandHome: vi.fn((p: string) => p.replace("~", "/home/test")),
}));

vi.mock("./add-source.js", () => ({
  detectSourceType: vi.fn((url: string) => {
    if (url.startsWith("./") || url.startsWith("/") || url.startsWith("~")) return "local";
    if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("git@")) return "url";
    return "github";
  }),
}));

import { existsSync, readFileSync } from "node:fs";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import {
  getStateServers,
  getStateSources,
  loadAgentfile,
  loadAgentfileFromPath,
  resolveAgentfileMcp,
} from "./agentfile.js";
import { applyAgentfile, mergeRulesIntoSharedContent } from "./agentfile-apply.js";
import { loadCatalog } from "./catalog/types.js";
import { MEMORY_MANAGED_SERVER_NAME, MEMORY_MANAGED_SOURCE, MEMORY_MCP_URL } from "./memory/constants.js";
import { loadState, saveState } from "./state.js";
import type { AgentBrewState, McpServer, Source } from "./types.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileAtomicSync);
const mockLoadAgentfile = vi.mocked(loadAgentfile);
const mockLoadAgentfileFromPath = vi.mocked(loadAgentfileFromPath);
const mockResolveAgentfileMcp = vi.mocked(resolveAgentfileMcp);
const mockGetStateServers = vi.mocked(getStateServers);
const mockGetStateSources = vi.mocked(getStateSources);
const mockLoadState = vi.mocked(loadState);
const mockSaveState = vi.mocked(saveState);
const mockLoadCatalog = vi.mocked(loadCatalog);

function makeState(overrides?: Partial<AgentBrewState>): AgentBrewState {
  return {
    mcpServers: [],
    sources: [],
    commandSourceDirs: [],
    agentSourceDirs: [],
    hooks: [],
    ...overrides,
  } as AgentBrewState;
}

function makeServer(name: string): McpServer {
  return { name, command: "npx", args: [name], env: {} } as McpServer;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("applyAgentfile", () => {
  describe("loading", () => {
    it("returns undefined when no Agentfile found", () => {
      mockLoadAgentfile.mockReturnValue(undefined);
      expect(applyAgentfile("/project")).toBeUndefined();
    });

    it("returns undefined when state is not initialized", () => {
      mockLoadAgentfile.mockReturnValue({ mcp: [] });
      mockLoadState.mockReturnValue(undefined as unknown as ReturnType<typeof loadState>);
      expect(applyAgentfile("/project")).toBeUndefined();
    });

    it("loads from path when .yaml extension is provided", () => {
      mockLoadAgentfileFromPath.mockReturnValue({ mcp: [] });
      mockLoadState.mockReturnValue(makeState());
      mockResolveAgentfileMcp.mockReturnValue([]);

      applyAgentfile("/project/Agentfile.yaml");
      expect(mockLoadAgentfileFromPath).toHaveBeenCalledWith("/project/Agentfile.yaml");
    });

    it("loads from directory when no extension", () => {
      mockLoadAgentfile.mockReturnValue({ mcp: [] });
      mockLoadState.mockReturnValue(makeState());
      mockResolveAgentfileMcp.mockReturnValue([]);

      applyAgentfile("/project");
      expect(mockLoadAgentfile).toHaveBeenCalledWith("/project");
    });
  });

  describe("MCP server merging", () => {
    it("adds new MCP servers from Agentfile", () => {
      const state = makeState();
      const newServer = makeServer("new-server");
      mockLoadAgentfile.mockReturnValue({ mcp: ["new-server"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([newServer]);
      mockGetStateServers.mockReturnValue([]);

      const result = applyAgentfile("/project");
      expect(result?.serversAdded).toContain("new-server");
      expect(mockSaveState).toHaveBeenCalled();
    });

    it("skips already-present MCP servers", () => {
      const existingServer = makeServer("existing");
      const state = makeState({ mcpServers: [existingServer] });
      mockLoadAgentfile.mockReturnValue({ mcp: ["existing"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([existingServer]);
      mockGetStateServers.mockReturnValue([existingServer]);

      const result = applyAgentfile("/project");
      expect(result?.serversAdded).toHaveLength(0);
    });

    it("repairs a missing managed memory server even when memory is already enabled", () => {
      const state = makeState({ memory: { enabled: true }, mcpServers: [] });
      mockLoadAgentfile.mockReturnValue({ memory: { enabled: true } });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);
      mockGetStateServers.mockReturnValue([]);

      applyAgentfile("/project", { quiet: true });

      expect(state.mcpServers).toHaveLength(1);
      expect(state.mcpServers?.[0]).toMatchObject({
        name: MEMORY_MANAGED_SERVER_NAME,
        source: MEMORY_MANAGED_SOURCE,
        url: MEMORY_MCP_URL,
      });
      expect(mockSaveState).toHaveBeenCalled();
    });

    it("repairs malformed memory registration and is a no-op on repeat", () => {
      const malformed = {
        name: MEMORY_MANAGED_SERVER_NAME,
        command: "node",
        args: ["broken.js"],
        env: { BROKEN: "1" },
        source: "agentfile",
        url: "http://127.0.0.1:9999/mcp",
        headers: { Authorization: "stale" },
        addedAt: "2026-01-01T00:00:00.000Z",
      };
      const state = makeState({ memory: { enabled: true }, mcpServers: [malformed] });
      mockLoadAgentfile.mockReturnValue({ memory: { enabled: true } });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);
      mockGetStateServers.mockReturnValue([]);

      applyAgentfile("/project", { quiet: true });
      expect(state.mcpServers?.[0]).toEqual({
        name: MEMORY_MANAGED_SERVER_NAME,
        command: "",
        args: [],
        env: {},
        source: MEMORY_MANAGED_SOURCE,
        url: MEMORY_MCP_URL,
        addedAt: "2026-01-01T00:00:00.000Z",
      });

      mockSaveState.mockClear();
      applyAgentfile("/project", { quiet: true });
      expect(mockSaveState).not.toHaveBeenCalled();
    });

    it("updates existing MCP server when command changes in Agentfile", () => {
      const existingServer = {
        name: "my-server",
        command: "npx",
        args: ["old-pkg"],
        env: {},
        source: "agentfile" as const,
      };
      const updatedServer = {
        name: "my-server",
        command: "npx",
        args: ["new-pkg"],
        env: {},
        source: "agentfile" as const,
      };
      const state = makeState({ mcpServers: [existingServer] });
      mockLoadAgentfile.mockReturnValue({ mcp: ["my-server"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([updatedServer]);
      mockGetStateServers.mockReturnValue([existingServer]);

      const result = applyAgentfile("/project");
      expect(result?.serversUpdated).toContain("my-server");
      expect(state.mcpServers?.[0].args).toEqual(["new-pkg"]);
      expect(mockSaveState).toHaveBeenCalled();
    });

    it("updates existing MCP server when env changes in Agentfile", () => {
      const existingServer = {
        name: "env-srv",
        command: "node",
        args: ["srv.js"],
        env: { KEY: "old" },
        source: "agentfile" as const,
      };
      const updatedServer = {
        name: "env-srv",
        command: "node",
        args: ["srv.js"],
        env: { KEY: "new" },
        source: "agentfile" as const,
      };
      const state = makeState({ mcpServers: [existingServer] });
      mockLoadAgentfile.mockReturnValue({ mcp: ["env-srv"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([updatedServer]);
      mockGetStateServers.mockReturnValue([existingServer]);

      const result = applyAgentfile("/project");
      expect(result?.serversUpdated).toContain("env-srv");
      expect(state.mcpServers?.[0].env).toEqual({ KEY: "new" });
    });

    it("does not update when server config is identical", () => {
      const server = { name: "same", command: "npx", args: ["pkg"], env: { A: "1" }, source: "agentfile" as const };
      const state = makeState({ mcpServers: [server] });
      mockLoadAgentfile.mockReturnValue({ mcp: ["same"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([{ ...server }]);
      mockGetStateServers.mockReturnValue([server]);

      const result = applyAgentfile("/project");
      expect(result?.serversUpdated).toHaveLength(0);
      expect(result?.serversAdded).toHaveLength(0);
    });

    it("removes servers not in Agentfile when authoritative", () => {
      const kept = makeServer("kept");
      const removed = makeServer("removed");
      const state = makeState({ mcpServers: [kept, removed] });
      mockLoadAgentfile.mockReturnValue({ mcp: ["kept"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([kept]);
      mockGetStateServers.mockReturnValue([kept, removed]);

      const result = applyAgentfile("/project", { authoritative: true });
      expect(result?.serversRemoved).toContain("removed");
    });

    it("preserves enabled managed memory during authoritative apply", () => {
      const memoryServer = {
        name: MEMORY_MANAGED_SERVER_NAME,
        command: "",
        args: [],
        env: {},
        source: MEMORY_MANAGED_SOURCE,
        url: MEMORY_MCP_URL,
        addedAt: "2026-01-01T00:00:00.000Z",
      };
      const state = makeState({ memory: { enabled: true }, mcpServers: [memoryServer] });
      mockLoadAgentfile.mockReturnValue({ memory: { enabled: true } });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);
      mockGetStateServers.mockReturnValue([memoryServer]);

      const result = applyAgentfile("/project", { authoritative: true, quiet: true });

      expect(result?.serversRemoved).not.toContain(MEMORY_MANAGED_SERVER_NAME);
      expect(state.mcpServers).toEqual([memoryServer]);
    });

    it("does not remove slack-work when it is present in the Agentfile and authoritative sync runs", () => {
      // Regression: slack-work was previously lost on every authoritative sync
      // because it was added as source:user rather than via the Agentfile.
      // Having it in the Agentfile must be sufficient to survive authoritative sync.
      const slackServer = makeServer("slack-work");
      const otherServer = makeServer("context7");
      const state = makeState({ mcpServers: [slackServer, otherServer] });
      mockLoadAgentfile.mockReturnValue({ mcp: ["slack-work", "context7"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([slackServer, otherServer]);
      mockGetStateServers.mockReturnValue([slackServer, otherServer]);

      const result = applyAgentfile("/project", { authoritative: true });
      expect(result?.serversRemoved).not.toContain("slack-work");
      expect(result?.serversRemoved).toHaveLength(0);
    });

    it("removes slack-work when it is missing from the Agentfile and authoritative sync runs", () => {
      // Confirms the authoritative behaviour still works in the other direction:
      // if the user deliberately removes slack-work from the Agentfile it should go.
      const slackServer = makeServer("slack-work");
      const otherServer = makeServer("context7");
      const state = makeState({ mcpServers: [slackServer, otherServer] });
      mockLoadAgentfile.mockReturnValue({ mcp: ["context7"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([otherServer]);
      mockGetStateServers.mockReturnValue([slackServer, otherServer]);

      const result = applyAgentfile("/project", { authoritative: true });
      expect(result?.serversRemoved).toContain("slack-work");
    });
  });

  describe("sources merging", () => {
    it("adds new sources from Agentfile", () => {
      const state = makeState({ sources: [] });
      mockLoadAgentfile.mockReturnValue({ sources: ["https://example.com/skills"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);
      mockGetStateSources.mockReturnValue([]);

      const result = applyAgentfile("/project");
      expect(result?.sourcesAdded).toContain("https://example.com/skills");
    });

    it("skips already-present sources", () => {
      const existingSource = { url: "https://example.com/skills" } as Source;
      const state = makeState({ sources: [existingSource] });
      mockLoadAgentfile.mockReturnValue({ sources: ["https://example.com/skills"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);
      mockGetStateSources.mockReturnValue([existingSource]);

      const result = applyAgentfile("/project");
      expect(result?.sourcesAdded).toHaveLength(0);
    });

    it("resolves relative path sources against the Agentfile directory", () => {
      const state = makeState({ sources: [] });
      mockLoadAgentfile.mockReturnValue({ sources: ["./.claude/skills"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);
      mockGetStateSources.mockReturnValue([]);

      applyAgentfile("/project");

      const added = state.sources?.find((s) => s.url === "/project/.claude/skills");
      expect(added?.type).toBe("local");
    });

    it("skips existing sources after relative path normalization", () => {
      const existingSource = { url: "/project/.claude/skills" } as Source;
      const state = makeState({ sources: [existingSource] });
      mockLoadAgentfile.mockReturnValue({ sources: ["./.claude/skills"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);
      mockGetStateSources.mockReturnValue([existingSource]);

      const result = applyAgentfile("/project");

      expect(result?.sourcesAdded).toHaveLength(0);
      expect(state.sources).toHaveLength(1);
    });

    it("assigns type: local for absolute path sources", () => {
      const state = makeState({ sources: [] });
      mockLoadAgentfile.mockReturnValue({ sources: ["/Users/me/my-skills"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);
      mockGetStateSources.mockReturnValue([]);

      applyAgentfile("/project");

      const added = state.sources?.find((s) => s.url === "/Users/me/my-skills");
      expect(added?.type).toBe("local");
    });

    it("assigns type: local for tilde path sources", () => {
      const state = makeState({ sources: [] });
      mockLoadAgentfile.mockReturnValue({ sources: ["~/my-skills"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);
      mockGetStateSources.mockReturnValue([]);

      applyAgentfile("/project");

      const added = state.sources?.find((s) => s.url === "~/my-skills");
      expect(added?.type).toBe("local");
    });

    it("assigns type: github for user/repo shorthand sources", () => {
      const state = makeState({ sources: [] });
      mockLoadAgentfile.mockReturnValue({ sources: ["user/custom-skills"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);
      mockGetStateSources.mockReturnValue([]);

      applyAgentfile("/project");

      const added = state.sources?.find((s) => s.url === "user/custom-skills");
      expect(added?.type).toBe("github");
    });

    it("assigns type: url for https sources", () => {
      const state = makeState({ sources: [] });
      mockLoadAgentfile.mockReturnValue({ sources: ["https://example.com/skills"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);
      mockGetStateSources.mockReturnValue([]);

      applyAgentfile("/project");

      const added = state.sources?.find((s) => s.url === "https://example.com/skills");
      expect(added?.type).toBe("url");
    });

    it("preserves team-origin sources during authoritative sync", () => {
      // Regression: `agentbrew sync` was silently dropping team-origin sources
      // (team-skills, example-app) on every cycle because the authoritative
      // reconcile compared state.sources against the Agentfile-declared list
      // and pruned anything missing — but team-overlay sources are owned by
      // `agentbrew team set|unset`, not by the global Agentfile being applied.
      // Effect on user host: 0 team-skills surfaced to any agent until the
      // workaround "add team-skills to global Agentfile" was applied.
      const teamSource = {
        url: "git@github.example.com:your-org/team-skills.git",
        type: "github",
        skillsInstalled: [],
        availableItems: [],
        addedAt: "2026-05-25T00:00:00Z",
        origin: "team:organization Engineering",
      } as Source;
      const userSource = {
        url: "https://example.com/user-skills",
        type: "url",
        skillsInstalled: [],
        availableItems: [],
        addedAt: "2026-05-25T00:00:00Z",
        origin: "agentfile",
      } as Source;
      const state = makeState({ sources: [teamSource, userSource] });
      // Agentfile declares ONLY user-skills — team source is not in it
      // because the team owns its own Agentfile.yaml overlay.
      mockLoadAgentfile.mockReturnValue({ sources: ["https://example.com/user-skills"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);
      mockGetStateSources.mockReturnValue([teamSource, userSource]);

      applyAgentfile("/project", { authoritative: true });

      // Both must remain — the team source because it's team-owned, the user
      // source because the Agentfile still declares it.
      const remainingUrls = new Set(state.sources?.map((s) => s.url));
      expect(remainingUrls).toContain("git@github.example.com:your-org/team-skills.git");
      expect(remainingUrls).toContain("https://example.com/user-skills");
    });

    it("still removes non-team sources missing from authoritative Agentfile", () => {
      // Confirms the prune still works in the intended direction: when the
      // user removes a source from the Agentfile, it should be pruned from
      // state. Only team-origined entries are protected.
      const staleSource = {
        url: "https://example.com/stale",
        type: "url",
        skillsInstalled: [],
        availableItems: [],
        addedAt: "2026-05-25T00:00:00Z",
        origin: "agentfile",
      } as Source;
      const keptSource = {
        url: "https://example.com/kept",
        type: "url",
        skillsInstalled: [],
        availableItems: [],
        addedAt: "2026-05-25T00:00:00Z",
        origin: "agentfile",
      } as Source;
      const state = makeState({ sources: [staleSource, keptSource] });
      mockLoadAgentfile.mockReturnValue({ sources: ["https://example.com/kept"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);
      mockGetStateSources.mockReturnValue([staleSource, keptSource]);

      applyAgentfile("/project", { authoritative: true });

      const remainingUrls = new Set(state.sources?.map((s) => s.url));
      expect(remainingUrls).not.toContain("https://example.com/stale");
      expect(remainingUrls).toContain("https://example.com/kept");
    });
  });

  describe("skills collection", () => {
    it("collects catalog skills from Agentfile", () => {
      const state = makeState();
      mockLoadAgentfile.mockReturnValue({ skills: ["known-skill"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);
      mockLoadCatalog.mockReturnValue({
        skills: [{ name: "known-skill" }],
        mcp_servers: [],
        rules: [],
      } as unknown as ReturnType<typeof loadCatalog>);

      const result = applyAgentfile("/project");
      expect(result?.skillsToInstall).toContain("known-skill");
    });

    it("warns about unknown skills", () => {
      const state = makeState();
      mockLoadAgentfile.mockReturnValue({ skills: ["unknown-skill"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);
      mockLoadCatalog.mockReturnValue({
        skills: [],
        mcp_servers: [],
        rules: [],
      } as unknown as ReturnType<typeof loadCatalog>);

      applyAgentfile("/project");
      expect(console.warn).toHaveBeenCalled();
    });

    it("prints the install plan with BOTH count and named skills so they can be cross-referenced", () => {
      // Regression guard for `status-numbers-self-consistent`: a bare "N skill(s)
      // to install" line was previously ambiguous when installRecommended
      // printed a separate named list right after, users read them as the same
      // list. Naming the Agentfile skills inline makes the two blocks distinct.
      const state = makeState();
      mockLoadAgentfile.mockReturnValue({ skills: ["debug", "plan", "review"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);
      mockLoadCatalog.mockReturnValue({
        skills: [{ name: "debug" }, { name: "plan" }, { name: "review" }],
        mcp_servers: [],
        rules: [],
      } as unknown as ReturnType<typeof loadCatalog>);

      applyAgentfile("/project");

      const output = vi.mocked(console.log).mock.calls.flat().join("\n");
      // Count and names in the same line — no more count-vs-list ambiguity.
      expect(output).toContain("3 skill(s) from Agentfile to install: debug, plan, review");
    });

    it("suppresses the install-plan line in quiet mode", () => {
      const state = makeState();
      mockLoadAgentfile.mockReturnValue({ skills: ["debug"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);
      mockLoadCatalog.mockReturnValue({
        skills: [{ name: "debug" }],
        mcp_servers: [],
        rules: [],
      } as unknown as ReturnType<typeof loadCatalog>);

      applyAgentfile("/project", { quiet: true });

      const output = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(output).not.toContain("from Agentfile to install");
    });
  });

  describe("rules merging", () => {
    const MARKED_BLOCK = [
      "<!-- agentfile-rules: project -->",
      "My custom rules",
      "<!-- /agentfile-rules: project -->",
    ].join("\n");

    it("writes new rules wrapped in agentfile-rules markers", () => {
      const state = makeState();
      mockLoadAgentfile.mockReturnValue({ rules: "My custom rules" });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);
      mockExistsSync.mockReturnValue(false);

      const result = applyAgentfile("/project");
      expect(result?.rulesUpdated).toBe(true);
      const written = mockWriteFileSync.mock.calls[0]?.[1] as string;
      expect(written).toContain("<!-- agentfile-rules: project -->");
      expect(written).toContain("My custom rules");
      expect(written).toContain("<!-- /agentfile-rules: project -->");
    });

    it("re-apply with unchanged content is a no-op", () => {
      const state = makeState();
      mockLoadAgentfile.mockReturnValue({ rules: "My custom rules" });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(`# Core\n\n${MARKED_BLOCK}\n` as unknown as ReturnType<typeof readFileSync>);

      const result = applyAgentfile("/project");
      expect(result?.rulesUpdated).toBe(false);
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it("re-apply with changed content REPLACES the marked block instead of appending", () => {
      const state = makeState();
      mockLoadAgentfile.mockReturnValue({ rules: "New wording v2" });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        `# Core stays\n\n${MARKED_BLOCK.replace("My custom rules", "Old wording v1")}\n\n## Tail stays\n` as unknown as ReturnType<
          typeof readFileSync
        >,
      );

      const result = applyAgentfile("/project");
      expect(result?.rulesUpdated).toBe(true);
      const written = mockWriteFileSync.mock.calls[0]?.[1] as string;
      expect(written).toContain("New wording v2");
      expect(written).not.toContain("Old wording v1");
      expect(written).toContain("# Core stays");
      expect(written).toContain("## Tail stays");
      expect(written.match(/<!-- agentfile-rules: project -->/g)).toHaveLength(1);
    });

    it("adopts a legacy unmarked copy by wrapping it in markers in place", () => {
      const state = makeState();
      mockLoadAgentfile.mockReturnValue({ rules: "My custom rules" });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        "# Core\n\nMy custom rules\n\n## Tail\n" as unknown as ReturnType<typeof readFileSync>,
      );

      const result = applyAgentfile("/project");
      expect(result?.rulesUpdated).toBe(true);
      const written = mockWriteFileSync.mock.calls[0]?.[1] as string;
      expect(written.match(/My custom rules/g)).toHaveLength(1);
      expect(written.indexOf("<!-- agentfile-rules: project -->")).toBeLessThan(written.indexOf("My custom rules"));
      expect(written.indexOf("<!-- /agentfile-rules: project -->")).toBeGreaterThan(written.indexOf("My custom rules"));
      expect(written).toContain("## Tail");
    });

    it("does not adopt content owned by another Agentfile's marked block", () => {
      const state = makeState();
      mockLoadAgentfile.mockReturnValue({ rules: "Shared body" });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        "<!-- agentfile-rules: other -->\nShared body\n<!-- /agentfile-rules: other -->\n" as unknown as ReturnType<
          typeof readFileSync
        >,
      );

      const result = applyAgentfile("/project");
      expect(result?.rulesUpdated).toBe(true);
      const written = mockWriteFileSync.mock.calls[0]?.[1] as string;
      expect(written).toContain("<!-- agentfile-rules: other -->");
      expect(written.match(/<!-- agentfile-rules: project -->/g)).toHaveLength(1);
      expect(written.match(/Shared body/g)).toHaveLength(2);
    });

    it("strips duplicate subsections already present in shared-rules before merge", () => {
      const divider = "─".repeat(20);
      const duplicate = `── Tooling/oncall repo delivery mandate ${divider}\nduplicate body`;
      const unique = `── Fresh Agentfile-only rule ${divider}\nkeep me`;
      const incoming = [duplicate, "", unique].join("\n");
      const existing = `# Core\n\n${duplicate}\n`;

      const { content, changed } = mergeRulesIntoSharedContent(existing, incoming, "dotfiles");
      expect(changed).toBe(true);
      expect(content.match(/duplicate body/g)).toHaveLength(1);
      expect(content).toContain("keep me");
      expect(content).toContain("<!-- agentfile-rules: dotfiles -->");
    });

    it("resolves relative rules file path", () => {
      const state = makeState();
      mockLoadAgentfile.mockReturnValue({ rules: "./rules.md" });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);
      mockExistsSync.mockImplementation((p) => {
        if (typeof p === "string" && p === "/project/rules.md") return true;
        return false;
      });
      mockReadFileSync.mockImplementation((p) => {
        if (typeof p === "string" && p === "/project/rules.md")
          return "File-based rules" as unknown as ReturnType<typeof readFileSync>;
        return "" as unknown as ReturnType<typeof readFileSync>;
      });

      const result = applyAgentfile("/project");
      expect(result?.rulesUpdated).toBe(true);
      const written = mockWriteFileSync.mock.calls[0]?.[1] as string;
      expect(written).toContain("File-based rules");
      expect(written).toContain("<!-- agentfile-rules: project -->");
    });
  });

  describe("commands and agents merging", () => {
    it("adds command source dirs from Agentfile", () => {
      const state = makeState({ commandSourceDirs: [] });
      mockLoadAgentfile.mockReturnValue({ commands: ["./commands"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);

      const result = applyAgentfile("/project");
      expect(result?.commandDirsAdded).toHaveLength(1);
      expect(result?.commandDirsAdded[0]).toContain("commands");
    });

    it("adds agent source dirs from Agentfile", () => {
      const state = makeState({ agentSourceDirs: [] });
      mockLoadAgentfile.mockReturnValue({ agents: ["./agents"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);

      const result = applyAgentfile("/project");
      expect(result?.agentDirsAdded).toHaveLength(1);
      expect(result?.agentDirsAdded[0]).toContain("agents");
    });
  });

  describe("hooks merging", () => {
    it("adds hooks from Agentfile", () => {
      const state = makeState({ hooks: [] });
      mockLoadAgentfile.mockReturnValue({
        hooks: [{ event: "pre-commit", command: "lint" }],
      });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);

      const result = applyAgentfile("/project");
      expect(result?.hooksUpdated).toBe(true);
    });

    it("detects no change when hooks match", () => {
      const existingHooks = [
        { event: "pre-commit", matcher: "*", type: "command" as const, command: "lint", source: "agentfile" as const },
      ];
      const state = makeState({ hooks: existingHooks });
      mockLoadAgentfile.mockReturnValue({
        hooks: [{ event: "pre-commit", command: "lint" }],
      });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);

      const result = applyAgentfile("/project");
      expect(result?.hooksUpdated).toBe(false);
    });
  });

  describe("recommended flag", () => {
    it("passes through recommended flag", () => {
      const state = makeState();
      mockLoadAgentfile.mockReturnValue({ recommended: true });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);

      const result = applyAgentfile("/project");
      expect(result?.recommendedRequested).toBe(true);
    });

    it("defaults recommended to false", () => {
      const state = makeState();
      mockLoadAgentfile.mockReturnValue({});
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);

      const result = applyAgentfile("/project");
      expect(result?.recommendedRequested).toBe(false);
    });
  });

  describe("state persistence", () => {
    it("does not save state when nothing changed", () => {
      const state = makeState();
      mockLoadAgentfile.mockReturnValue({});
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);

      applyAgentfile("/project");
      expect(mockSaveState).not.toHaveBeenCalled();
    });

    it("saves state when servers are added", () => {
      const state = makeState();
      mockLoadAgentfile.mockReturnValue({ mcp: ["server"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([makeServer("server")]);
      mockGetStateServers.mockReturnValue([]);

      applyAgentfile("/project");
      expect(mockSaveState).toHaveBeenCalledWith(state);
    });

    it("dry-run previews state and rules changes without saving or writing", () => {
      const state = makeState({ sources: [], commandSourceDirs: [], agentSourceDirs: [], hooks: [] });
      mockLoadAgentfile.mockReturnValue({
        sources: ["./skills"],
        commands: ["./commands"],
        agents: ["./agents"],
        rules: "Project rules",
        hooks: [{ event: "PreToolUse", command: "echo hi" }],
      });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);
      mockGetStateSources.mockReturnValue([]);
      mockExistsSync.mockReturnValue(false);

      const result = applyAgentfile("/project", { dryRun: true });

      expect(result?.sourcesAdded).toContain("/project/skills");
      expect(result?.commandDirsAdded).toHaveLength(1);
      expect(result?.agentDirsAdded).toHaveLength(1);
      expect(result?.rulesUpdated).toBe(true);
      expect(result?.hooksUpdated).toBe(true);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Agentfile preview"));
      expect(mockSaveState).not.toHaveBeenCalled();
      expect(mockWriteFileSync).not.toHaveBeenCalled();
      expect(state.sources).toHaveLength(0);
      expect(state.commandSourceDirs).toHaveLength(0);
      expect(state.agentSourceDirs).toHaveLength(0);
      expect(state.hooks).toHaveLength(0);
    });

    it("dry-run previews existing server updates without mutating loaded state", () => {
      const existingServer = makeServer("srv");
      const state = makeState({ mcpServers: [existingServer] });
      mockLoadAgentfile.mockReturnValue({ mcp: ["srv"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([{ ...existingServer, args: ["new"] }]);
      mockGetStateServers.mockImplementation((s: AgentBrewState) => [...(s.mcpServers ?? [])]);

      const result = applyAgentfile("/project", { dryRun: true });

      expect(result?.serversUpdated).toContain("srv");
      expect(state.mcpServers?.[0].args).toEqual(["srv"]);
      expect(mockSaveState).not.toHaveBeenCalled();
    });

    it("dry-run can apply into a caller-provided virtual state", () => {
      const persistedState = makeState({ mcpServers: [] });
      const virtualState = makeState({ mcpServers: [] });
      mockLoadAgentfile.mockReturnValue({ mcp: ["virtual"] });
      mockLoadState.mockReturnValue(persistedState);
      mockResolveAgentfileMcp.mockReturnValue([makeServer("virtual")]);
      mockGetStateServers.mockImplementation((s: AgentBrewState) => [...(s.mcpServers ?? [])]);

      const result = applyAgentfile("/project", { dryRun: true, stateOverride: virtualState });

      expect(result?.serversAdded).toContain("virtual");
      expect(virtualState.mcpServers?.map((server) => server.name)).toContain("virtual");
      expect(persistedState.mcpServers).toEqual([]);
      expect(mockLoadState).not.toHaveBeenCalled();
      expect(mockSaveState).not.toHaveBeenCalled();
    });
  });

  describe("excludeAgents", () => {
    it("flips detected: false on state.agents whose name appears in excludeAgents", () => {
      const state = makeState({
        agents: [
          { name: "claude-code", detected: true, skillsDir: "~/.claude/skills" },
          { name: "augment", detected: true, skillsDir: "~/.augment/skills" },
          { name: "kiro", detected: true, skillsDir: "~/.kiro/skills" },
          { name: "cursor", detected: true, skillsDir: "~/.cursor/skills" },
        ] as AgentBrewState["agents"],
      });
      mockLoadAgentfile.mockReturnValue({ excludeAgents: ["augment", "kiro"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);

      const result = applyAgentfile("/project");

      expect(result?.excludedAgents).toEqual(["augment", "kiro"]);
      expect(state.agents.find((a) => a.name === "claude-code")?.detected).toBe(true);
      expect(state.agents.find((a) => a.name === "augment")?.detected).toBe(false);
      expect(state.agents.find((a) => a.name === "kiro")?.detected).toBe(false);
      expect(state.agents.find((a) => a.name === "cursor")?.detected).toBe(true);
    });

    it("returns empty excludedAgents when none of the excludes were previously detected", () => {
      const state = makeState({
        agents: [
          { name: "claude-code", detected: true, skillsDir: "~/.claude/skills" },
          { name: "augment", detected: false, skillsDir: "~/.augment/skills" },
        ] as AgentBrewState["agents"],
      });
      mockLoadAgentfile.mockReturnValue({ excludeAgents: ["augment"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);

      const result = applyAgentfile("/project");

      // augment was already detected: false, so no flip happened
      expect(result?.excludedAgents).toEqual([]);
    });

    it("ignores excludeAgents names that don't exist in state.agents", () => {
      const state = makeState({
        agents: [{ name: "claude-code", detected: true, skillsDir: "~/.claude/skills" }] as AgentBrewState["agents"],
      });
      mockLoadAgentfile.mockReturnValue({ excludeAgents: ["nonexistent-agent"] });
      mockLoadState.mockReturnValue(state);
      mockResolveAgentfileMcp.mockReturnValue([]);

      const result = applyAgentfile("/project");

      expect(result?.excludedAgents).toEqual([]);
      expect(state.agents[0]?.detected).toBe(true);
    });
  });
});
