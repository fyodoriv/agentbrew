import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig, McpServer, SkillSourceDir, Source } from "../types.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    cpSync: vi.fn(),
    mkdirSync: vi.fn(),
    // readFileSync is mocked for command files written by installCliTool;
    // catalog.yaml loading uses the real readFileSync via loadCatalog (which bypasses this
    // mock because it is hoisted — but we restore the real impl via beforeEach).
    readFileSync: vi.fn((path: Parameters<typeof original.readFileSync>[0], ...rest) => {
      const stringPath = String(path);
      if (stringPath.endsWith(".md") && stringPath.includes("cli-commands")) {
        return "# fake command content";
      }
      return original.readFileSync(path, ...rest);
    }),
    rmSync: vi.fn(),
  };
});

vi.mock("write-file-atomic", () => ({
  sync: vi.fn(),
}));

vi.mock("../state.js", () => {
  const loadState = vi.fn();
  return { loadState, requireState: loadState, saveState: vi.fn() };
});

vi.mock("../sync/mcp-sync.js", () => ({
  addMcpServer: vi.fn(),
}));

// `installMcpServer` (catalog path) calls into `mcp-delegate.js` to bridge
// catalog MCP installs to mcpm for the intersection agents (claude-code,
// codex, cline, etc.). Without this mock, every `install` test that
// covers an MCP server would spawn a real `mcpm` subprocess via execFileSync.
vi.mock("../sync/mcp-delegate.js", () => ({
  delegateMcpInstall: vi.fn(() => ({ ok: false, carveOuts: [] })),
  delegateMcpClientEdit: vi.fn(() => ({ ok: false, carveOuts: [], perClient: [] })),
  delegateMcpUninstall: vi.fn(() => ({
    ok: false,
    carveOuts: [],
    perClient: [],
    globalUninstall: { ok: false },
  })),
  delegateMcpNew: vi.fn(() => ({ ok: false })),
  readMcpmServer: vi.fn(() => undefined),
  // Slice 2 of `bridge-mcp-sync-to-mcpm-for-intersection`: must be
  // mocked so the sync-time bridge in `syncMcpServers` doesn't read
  // the user's real `~/.config/mcpm/servers.json` during tests.
  listMcpmServerNames: vi.fn(() => new Set<string>()),
}));

vi.mock("../sync/rules-sync.js", () => ({
  loadSharedRules: vi.fn(() => undefined),
  saveSharedRules: vi.fn(),
}));

vi.mock("./index-source.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./index-source.js")>();
  return {
    ...original,
    getSourceCachePath: vi.fn(),
    scanDirectoryForSkills: vi.fn(original.scanDirectoryForSkills),
  };
});

vi.mock("../lock.js", () => ({
  lockSource: vi.fn(),
}));

vi.mock("../skills/skill-versions.js", () => ({
  recordSourceSha: vi.fn(),
}));

vi.mock("../mcp/mcp-setup.js", () => ({
  extractEnvVars: vi.fn(() => []),
  isEnvVarResolved: vi.fn(() => true),
}));

vi.mock("../mcp/mcp-status.js", () => ({
  getSetupInstructions: vi.fn(() => ({})),
}));

vi.mock("../suggest.js", () => ({
  formatSuggestion: vi.fn(() => undefined),
}));

vi.mock("../agentfile.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../agentfile.js")>();
  return {
    ...original,
    addToAgentfile: vi.fn(() => true),
    globalAgentfileDir: vi.fn(() => "/mock/config/agentbrew"),
    installSkillToProject: vi.fn(),
    addSkillToAgentfile: vi.fn(() => true),
  };
});

vi.mock("@inquirer/prompts", () => ({
  select: vi.fn(() => Promise.resolve("a/repo")),
}));

vi.mock("./types.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./types.js")>();
  // Keep a reference to the real loadCatalog so beforeEach can restore it after vi.clearAllMocks()
  const realLoadCatalog = original.loadCatalog;
  const mockLoad = vi.fn(realLoadCatalog);
  // Attach the real fn for later restoration
  (mockLoad as unknown as { _real: typeof realLoadCatalog })._real = realLoadCatalog;
  return {
    ...original,
    loadCatalog: mockLoad,
  };
});

import { cpSync, mkdirSync, rmSync } from "node:fs";
import { select } from "@inquirer/prompts";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { addToAgentfile, installSkillToProject } from "../agentfile.js";
import { lockSource } from "../lock.js";
import { extractEnvVars, isEnvVarResolved } from "../mcp/mcp-setup.js";
import { getSetupInstructions } from "../mcp/mcp-status.js";
import { loadState, saveState } from "../state.js";
import { formatSuggestion } from "../suggest.js";
import { delegateMcpClientEdit, delegateMcpInstall, delegateMcpNew, readMcpmServer } from "../sync/mcp-delegate.js";
import { addMcpServer } from "../sync/mcp-sync.js";
import { getSourceCachePath, scanDirectoryForSkills } from "./index-source.js";
import { flushInstallSummary, install } from "./install.js";
import { resetSourceFallbackAnnounced } from "./install-skill.js";
import { mockSkillCacheExists } from "./mock-skill-cache-exists.js";
import { loadCatalog } from "./types.js";

const mockCpSync = vi.mocked(cpSync);
const mockRmSync = vi.mocked(rmSync);
const mockWriteFileAtomicSync = vi.mocked(writeFileAtomicSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockSelect = vi.mocked(select);
const mockLoadCatalog = vi.mocked(loadCatalog);
const mockLoadState = vi.mocked(loadState);
const mockSaveState = vi.mocked(saveState);
const mockGetSourceCachePath = vi.mocked(getSourceCachePath);
const mockScanDirectoryForSkills = vi.mocked(scanDirectoryForSkills);
const mockAddMcpServer = vi.mocked(addMcpServer);
const mockDelegateMcpInstall = vi.mocked(delegateMcpInstall);
const mockDelegateMcpClientEdit = vi.mocked(delegateMcpClientEdit);
const mockDelegateMcpNew = vi.mocked(delegateMcpNew);
const mockReadMcpmServer = vi.mocked(readMcpmServer);
const mockAddToAgentfile = vi.mocked(addToAgentfile);
const mockInstallSkillToProject = vi.mocked(installSkillToProject);
const mockLockSource = vi.mocked(lockSource);
const mockExtractEnvVars = vi.mocked(extractEnvVars);
const mockGetSetupInstructions = vi.mocked(getSetupInstructions);
const mockIsEnvVarResolved = vi.mocked(isEnvVarResolved);
const mockFormatSuggestion = vi.mocked(formatSuggestion);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockGetSourceCachePath.mockReturnValue("/cache/test");
  // Reset the in-process source-fallback announcement cache so each test starts
  // clean and can independently assert "banner prints once, subsequent are compact".
  resetSourceFallbackAnnounced();
  // Restore default: loadCatalog reads real catalog.yaml (vi.clearAllMocks wipes the impl)
  const real = (mockLoadCatalog as unknown as { _real?: () => ReturnType<typeof loadCatalog> })._real;
  if (real) mockLoadCatalog.mockImplementation(real);
});

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    agents: [] as AgentConfig[],
    sources: [] as Source[],
    mcpServers: [] as McpServer[],
    catalogVersion: "0.1.0",
    skillSourceDirs: [] as SkillSourceDir[],
    ...overrides,
  };
}

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    url: "test/repo",
    type: "github",
    skillsInstalled: [],
    availableItems: [],
    addedAt: "2026-01-01",
    ...overrides,
  };
}

// ── installCliTool ──────────────────────────────────────────────────────────

/** Returns a minimal catalog with one fake cli tool so installCliTool is reachable. */
function makeCatalogWithCliTool(
  toolOverrides: Partial<{
    name: string;
    commands: string[];
    env: Record<string, string>;
    note: string;
    setup: Record<string, { description: string; link?: string; steps?: string[] }>;
  }> = {},
) {
  return {
    skills: [],
    mcp_servers: [],
    rules: [],
    cli_tools: [
      {
        name: toolOverrides.name ?? "fake-tool",
        description: "A fake CLI tool for testing",
        category: "testing",
        recommended: false,
        commands: toolOverrides.commands ?? ["fake-cmd"],
        env: toolOverrides.env,
        note: toolOverrides.note,
        setup: toolOverrides.setup,
      },
    ],
  };
}

describe("installCliTool", () => {
  it("warns when command file source dir is not found", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockLoadCatalog.mockReturnValue(makeCatalogWithCliTool({ name: "fake-tool", commands: ["fake-cmd"] }));
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync").mockReturnValue(false);
    await install("fake-tool");
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("Installing CLI tool");
    expect(logs).toContain("Command files not found");
    existsSpy.mockRestore();
  });

  it("copies command files when source dir and files exist", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockLoadCatalog.mockReturnValue(makeCatalogWithCliTool({ name: "fake-tool", commands: ["fake-cmd"] }));
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    existsSpy.mockImplementation((path) => {
      const stringPath = String(path);
      if (stringPath.includes("cli-commands/fake-tool")) return true;
      if (stringPath.endsWith("fake-cmd.md")) return true;
      return false;
    });
    await install("fake-tool");
    expect(mockWriteFileAtomicSync).toHaveBeenCalled();
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("fake-cmd.md");
    existsSpy.mockRestore();
  });

  it("uses a command entry that already ends with .md without duplicating the suffix", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockLoadCatalog.mockReturnValue(makeCatalogWithCliTool({ name: "fake-tool", commands: ["already.md"] }));
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    existsSpy.mockImplementation((path) => {
      const stringPath = String(path);
      if (stringPath.includes("cli-commands/fake-tool")) return true;
      if (stringPath.endsWith("already.md")) return true;
      return false;
    });
    await install("fake-tool");
    expect(mockWriteFileAtomicSync).toHaveBeenCalled();
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("already.md");
    expect(logs).not.toContain("already.md.md");
    existsSpy.mockRestore();
  });

  it("warns when a command file is missing from the source dir", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockLoadCatalog.mockReturnValue(makeCatalogWithCliTool({ name: "fake-tool", commands: ["missing-cmd"] }));
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    existsSpy.mockImplementation((path) => {
      const stringPath = String(path);
      // Source dir exists but .md file does not
      if (stringPath.includes("cli-commands/fake-tool") && !stringPath.endsWith(".md")) return true;
      return false;
    });
    await install("fake-tool");
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("not found in catalog");
    existsSpy.mockRestore();
  });

  it("shows env var warning and setup instructions when vars are missing", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockLoadCatalog.mockReturnValue(
      makeCatalogWithCliTool({
        name: "fake-tool",
        commands: [], // empty commands list — no files to copy, but source dir must be found
        env: { FAKE_TOKEN: "${FAKE_TOKEN}" },
        note: "Get your token at example.com",
        setup: {
          FAKE_TOKEN: {
            description: "API token",
            link: "https://example.com/token",
            steps: ["Open link", "Copy token"],
          },
        },
      }),
    );
    mockIsEnvVarResolved.mockReturnValue(false);
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    // Make the source dir exist so the function does not return early at "Command files not found"
    existsSpy.mockImplementation((path) => {
      const stringPath = String(path);
      if (stringPath.includes("cli-commands/fake-tool")) return true;
      return false;
    });
    await install("fake-tool");
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("needs");
    expect(logs).toContain("env var");
    existsSpy.mockRestore();
  });

  it("does not show env var warning when all vars are resolved", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockLoadCatalog.mockReturnValue(
      makeCatalogWithCliTool({
        name: "fake-tool",
        commands: [],
        env: { FAKE_TOKEN: "${FAKE_TOKEN}" },
      }),
    );
    mockIsEnvVarResolved.mockReturnValue(true);
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    existsSpy.mockImplementation((path) => {
      const stringPath = String(path);
      if (stringPath.includes("cli-commands/fake-tool")) return true;
      return false;
    });
    await install("fake-tool");
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).not.toContain("env var");
    existsSpy.mockRestore();
  });

  // Regression: production binaries run from `dist/cli.js`, where
  // `import.meta.dirname` is `dist/`, so `<dirname>/../cli-commands/<tool>/`
  // is never reachable but `<dirname>/cli-commands/<tool>/` (copied by
  // the tsup `onSuccess` hook to `dist/cli-commands/`) is. The resolver
  // tries the source-mode path first, then falls through to the
  // bundled-mode path. The test simulates bundled-mode by accepting
  // only the `<dirname>/cli-commands/<tool>` path; both path strings
  // are absolute and distinguishable because they share no common
  // suffix beyond `cli-commands/<tool>`.
  it("falls back to the bundled-mode path when the source-mode path is missing", async () => {
    const { join } = await import("node:path");
    const sourceModeDir = join(import.meta.dirname, "..", "cli-commands", "fake-tool");
    const bundledModeDir = join(import.meta.dirname, "cli-commands", "fake-tool");
    mockLoadState.mockReturnValue(makeState());
    mockLoadCatalog.mockReturnValue(makeCatalogWithCliTool({ name: "fake-tool", commands: ["fake-cmd"] }));
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    existsSpy.mockImplementation((path) => {
      const stringPath = String(path);
      if (stringPath === sourceModeDir) return false;
      if (stringPath === bundledModeDir) return true;
      if (stringPath.endsWith("fake-cmd.md")) return true;
      return false;
    });
    await install("fake-tool");
    expect(mockWriteFileAtomicSync).toHaveBeenCalled();
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("fake-cmd.md");
    expect(logs).not.toContain("Command files not found");
    existsSpy.mockRestore();
  });
});

// ── installMcpServer — missing env vars ────────────────────────────────────

describe("installMcpServer — missing env vars", () => {
  it("shows warning and setup instructions when env vars are unresolved", async () => {
    mockLoadState.mockReturnValue(makeState());
    // github MCP server has an env var GITHUB_TOKEN
    mockExtractEnvVars.mockReturnValue(["GITHUB_PERSONAL_ACCESS_TOKEN"]);
    mockIsEnvVarResolved.mockReturnValue(false);
    mockGetSetupInstructions.mockReturnValue({
      GITHUB_PERSONAL_ACCESS_TOKEN: {
        description: "Personal access token for GitHub API",
        link: "https://github.com/settings/tokens",
        steps: ["Open link", "Create token"],
      },
    });
    await install("github");
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("needs");
    expect(logs).toContain("GITHUB_PERSONAL_ACCESS_TOKEN");
    expect(mockAddMcpServer).toHaveBeenCalled();
  });

  it("shows note when server has a note field and missing vars", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExtractEnvVars.mockReturnValue(["SPLUNK_MCP_URL"]);
    mockIsEnvVarResolved.mockReturnValue(false);
    mockGetSetupInstructions.mockReturnValue({});
    await install("splunk");
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("needs");
    expect(mockAddMcpServer).toHaveBeenCalled();
  });

  it("does not show env var warning when all vars are resolved", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockExtractEnvVars.mockReturnValue(["GITHUB_PERSONAL_ACCESS_TOKEN"]);
    mockIsEnvVarResolved.mockReturnValue(true);
    await install("github");
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).not.toContain("needs");
    expect(mockAddMcpServer).toHaveBeenCalled();
  });
});

// ── installMcpServer — install failures ─────────────────────────────────────

describe("installMcpServer — install failures", () => {
  it("propagates when addMcpServer rejects", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockAddMcpServer.mockRejectedValueOnce(new Error("MCP registry unavailable"));
    await expect(install("github")).rejects.toThrow("MCP registry unavailable");
    expect(mockAddMcpServer).toHaveBeenCalled();
  });
});

// ── installMcpServer — Agentfile persistence ────────────────────────────────

describe("installMcpServer — Agentfile persistence", () => {
  it("persists MCP server to global Agentfile after adding to state", async () => {
    mockLoadState.mockReturnValue(makeState());
    await install("github");
    expect(mockAddMcpServer).toHaveBeenCalled();
    expect(mockAddToAgentfile).toHaveBeenCalledWith(
      "/mock/config/agentbrew",
      expect.objectContaining({ name: "github", source: "catalog" }),
      { create: true },
    );
  });
});

// ── installMcpServer — HTTP-transport entries (url, no command) ─────────────
// Pins the fix for `install-supports-http-transport-mcp`.
// Before: `installMcpServer` passed an empty `command` to `addMcpServer`
// without the `options.url`, so validation threw "MCP server has an empty
// command. Stdio servers require a non-empty command." even when the
// catalog entry had a valid `url:` field — blocking `install --recommended`
// on overlays that ship HTTP MCPs (e.g. agentbrew-acme's `Acme Portal MCP
// Remote` routed through codegen's localhost:8098 proxy).

describe("installMcpServer — HTTP transport", () => {
  it("passes url + headers through to addMcpServer when catalog entry has url instead of command", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockLoadCatalog.mockReturnValue({
      skills: [],
      cli_tools: [],
      rules: [],
      mcp_servers: [
        {
          name: "http-mcp-test",
          description: "HTTP-transport MCP via local proxy",
          url: "http://localhost:8098/HTTP%20MCP%20Test",
          headers: { Authorization: "Bearer test" },
          env: {},
          category: "observability",
          recommended: true,
        },
      ],
    });
    await install("http-mcp-test");
    expect(mockAddMcpServer).toHaveBeenCalledWith(
      "http-mcp-test",
      "",
      [],
      {},
      expect.objectContaining({
        url: "http://localhost:8098/HTTP%20MCP%20Test",
        headers: { Authorization: "Bearer test" },
      }),
    );
  });

  it("omits url + headers from options when the catalog entry is stdio-only", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockLoadCatalog.mockReturnValue({
      skills: [],
      cli_tools: [],
      rules: [],
      mcp_servers: [
        {
          name: "stdio-mcp-test",
          description: "Stdio-transport MCP",
          command: "npx",
          args: ["-y", "@example/mcp"],
          env: {},
          category: "dev",
          recommended: false,
        },
      ],
    });
    await install("stdio-mcp-test");
    expect(mockAddMcpServer).toHaveBeenCalledWith("stdio-mcp-test", "npx", ["-y", "@example/mcp"], {}, {});
  });
});

// ── installMcpServer — bridge to mcpm for the MCP_INTERSECTION_AGENTS mcpm intersection ──────────
//
// Slices 4a + 5a of `delegate-mcp-to-mcpm` removed native MCP-config writes
// for the intersection clients (claude-code, codex, cline, etc.). The
// follow-up bridge in `install-other.ts` re-introduces the wire-up from the
// catalog install path so users see the server land in their actual config
// files when they run `agentbrew install <name>`. These tests pin the
// short-circuits, the per-agent routing, and the failure-mode invariants.

describe("installMcpServer — bridge to mcpm", () => {
  function makeAgent(name: string, detected: boolean): AgentConfig {
    return { name, detected } as unknown as AgentConfig;
  }

  it("short-circuits when no agents are detected at all", async () => {
    // Empty agents array — bridge must not call mcpm.
    mockLoadState.mockReturnValue(makeState());
    await install("github");
    expect(mockAddMcpServer).toHaveBeenCalled();
    expect(mockDelegateMcpInstall).not.toHaveBeenCalled();
    expect(mockDelegateMcpClientEdit).not.toHaveBeenCalled();
  });

  it("short-circuits when only carve-out agents are detected (no intersection clients)", async () => {
    // devin + copilot are explicit carve-outs. Without the short-
    // circuit, slice-4c-era code would still spawn `mcpm install` even
    // though the result has nowhere useful to land — wasteful subprocess
    // call that makes the catalog install path unnecessarily slow.
    mockLoadState.mockReturnValue(
      makeState({
        agents: [makeAgent("devin", true), makeAgent("copilot", true)],
      }),
    );
    await install("github");
    expect(mockAddMcpServer).toHaveBeenCalled();
    expect(mockDelegateMcpInstall).not.toHaveBeenCalled();
    expect(mockDelegateMcpClientEdit).not.toHaveBeenCalled();
  });

  it("calls mcpm install + client edit when intersection agents are detected", async () => {
    // cline + claude-code are core intersection clients. Bridge fires
    // `delegateMcpInstall` first and `delegateMcpClientEdit` after. The
    // `readMcpmServer` mock simulates a server that landed in mcpm's
    // global config (public-registry path) so the bridge skips the new
    // mcpm-new fallback and proceeds straight to client-edit.
    mockLoadState.mockReturnValue(
      makeState({
        agents: [makeAgent("cline", true), makeAgent("claude-code", true)],
      }),
    );
    mockDelegateMcpInstall.mockReturnValueOnce({ ok: true, carveOuts: [] });
    mockReadMcpmServer.mockReturnValueOnce({
      name: "github",
      command: "npx",
      args: ["-y", "github"],
      env: {},
      source: "mcpm",
    });
    mockDelegateMcpClientEdit.mockReturnValueOnce({
      ok: true,
      carveOuts: [],
      perClient: [
        { client: "cline", ok: true },
        { client: "claude-code", ok: true },
      ],
    });

    await install("github");

    expect(mockDelegateMcpInstall).toHaveBeenCalledWith({
      serverName: "github",
      agents: ["cline", "claude-code"],
    });
    expect(mockDelegateMcpClientEdit).toHaveBeenCalledWith({
      serverName: "github",
      agents: ["cline", "claude-code"],
    });
  });

  it("skips client edit when mcpm install fails (e.g. server not in mcpm catalog)", async () => {
    // mcpm doesn't know about team-overlay servers and custom catalog
    // additions — install fails, so the client-edit step has nothing to
    // wire up. Native state mutation already succeeded, so this is a
    // soft skip, not an error.
    mockLoadState.mockReturnValue(
      makeState({
        agents: [makeAgent("cline", true)],
      }),
    );
    mockDelegateMcpInstall.mockReturnValueOnce({ ok: false, carveOuts: [] });

    await install("github");

    expect(mockDelegateMcpInstall).toHaveBeenCalled();
    expect(mockDelegateMcpClientEdit).not.toHaveBeenCalled();
  });

  it("ignores undetected agents in the routing list", async () => {
    // Only `detected: true` agents enter the bridge — undetected ones
    // (the user has the binary installed but hasn't synced yet) shouldn't
    // get mcpm client edits.
    mockLoadState.mockReturnValue(
      makeState({
        agents: [
          makeAgent("cline", true),
          makeAgent("claude-code", false), // not detected — skip
          makeAgent("codex", true),
        ],
      }),
    );
    mockDelegateMcpInstall.mockReturnValueOnce({ ok: true, carveOuts: [] });
    mockReadMcpmServer.mockReturnValueOnce({
      name: "github",
      command: "npx",
      args: ["-y", "github"],
      env: {},
      source: "mcpm",
    });
    mockDelegateMcpClientEdit.mockReturnValueOnce({
      ok: true,
      carveOuts: [],
      perClient: [],
    });

    await install("github");

    expect(mockDelegateMcpInstall).toHaveBeenCalledWith({
      serverName: "github",
      agents: ["cline", "codex"],
    });
  });

  it("logs which clients got mcpm client configs", async () => {
    mockLoadState.mockReturnValue(
      makeState({
        agents: [makeAgent("cline", true), makeAgent("claude-code", true)],
      }),
    );
    mockDelegateMcpInstall.mockReturnValueOnce({ ok: true, carveOuts: [] });
    mockReadMcpmServer.mockReturnValueOnce({
      name: "github",
      command: "npx",
      args: ["-y", "github"],
      env: {},
      source: "mcpm",
    });
    mockDelegateMcpClientEdit.mockReturnValueOnce({
      ok: true,
      carveOuts: [],
      perClient: [
        { client: "cline", ok: true },
        { client: "claude-code", ok: true },
      ],
    });

    await install("github");

    const logs = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(logs).toContain("Wrote mcpm client configs for");
    expect(logs).toContain("cline");
    expect(logs).toContain("claude-code");
  });

  it("falls back to mcpm new when server is not in mcpm's public registry", async () => {
    // The mcpm-new fallback path: `mcpm install <name>` exits 0 even when
    // <name> isn't in mcpm's public registry — it prints "not found" to
    // stdout but doesn't update servers.json. The bridge verifies via
    // `readMcpmServer` and, on absence, replays the catalog's transport
    // shape through `mcpm new`. Closes the regression that left
    // team-overlay MCPs (registry.npmjs.example.com packages, custom
    // catalog entries) invisible to mcpm-delegated clients even though
    // `agentbrew install` reported success.
    mockLoadState.mockReturnValue(
      makeState({
        agents: [makeAgent("cline", true), makeAgent("claude-code", true)],
      }),
    );
    mockDelegateMcpInstall.mockReturnValueOnce({ ok: true, carveOuts: [] });
    mockReadMcpmServer.mockReturnValueOnce(undefined); // not in mcpm
    mockDelegateMcpNew.mockReturnValueOnce({ ok: true });
    mockDelegateMcpClientEdit.mockReturnValueOnce({
      ok: true,
      carveOuts: [],
      perClient: [
        { client: "cline", ok: true },
        { client: "claude-code", ok: true },
      ],
    });

    await install("github");

    expect(mockDelegateMcpNew).toHaveBeenCalledWith(expect.objectContaining({ serverName: "github" }));
    expect(mockDelegateMcpClientEdit).toHaveBeenCalled();
    const logs = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(logs).toContain("Registered github with mcpm via 'mcpm new'");
  });

  it("warns and skips client edit when both mcpm install and mcpm new fail", async () => {
    // Both registry resolution paths fail — log a single user-facing
    // warning so the agent operator knows intersection clients won't
    // see the server. Native state still has it (carve-outs work).
    mockLoadState.mockReturnValue(
      makeState({
        agents: [makeAgent("cline", true)],
      }),
    );
    mockDelegateMcpInstall.mockReturnValueOnce({ ok: true, carveOuts: [] });
    mockReadMcpmServer.mockReturnValueOnce(undefined);
    mockDelegateMcpNew.mockReturnValueOnce({ ok: false });

    await install("github");

    expect(mockDelegateMcpClientEdit).not.toHaveBeenCalled();
    const logs = (console.log as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(logs).toContain("Could not register github with mcpm");
  });
});

// ── installFromSource — lockSource logging ──────────────────────────────────

describe("installFromSource — lockSource logging", () => {
  it("logs lock sha when lockSource returns an entry", async () => {
    const source = makeSource({
      url: "a/repo",
      skillsInstalled: [],
      availableItems: [{ name: "debug", description: "", type: "skill" }],
    });
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    mockGetSourceCachePath.mockReturnValue("/cache/a_repo");
    mockLockSource.mockReturnValue({
      sha: "abc123456789",
      skills: ["debug"],
      source: "a/repo",
      type: "github",
      lockedAt: "",
    });
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    mockSkillCacheExists(existsSpy, "/cache/a_repo", "debug");
    await install("debug", { from: "a/repo" });
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("Locked");
    expect(logs).toContain("abc123");
    existsSpy.mockRestore();
  });

  it("does not log lock sha when lockSource returns undefined", async () => {
    const source = makeSource({
      url: "a/repo",
      skillsInstalled: [],
      availableItems: [{ name: "debug", description: "", type: "skill" }],
    });
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    mockGetSourceCachePath.mockReturnValue("/cache/a_repo");
    mockLockSource.mockReturnValue(undefined);
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    mockSkillCacheExists(existsSpy, "/cache/a_repo", "debug");
    await install("debug", { from: "a/repo" });
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).not.toContain("Locked");
    existsSpy.mockRestore();
  });
});

// ── copySkillFromCache — rmSync for stale copy ──────────────────────────────

describe("copySkillFromCache — stale copy removal", () => {
  it("removes stale destination dir before copying", async () => {
    const source = makeSource({
      url: "a/repo",
      skillsInstalled: [],
      availableItems: [{ name: "debug", description: "", type: "skill" }],
    });
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    mockGetSourceCachePath.mockReturnValue("/cache/a_repo");
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    mockSkillCacheExists(existsSpy, "/cache/a_repo", "debug", (stringPath) => {
      if (stringPath.includes("installed-skills/debug") && !stringPath.includes("SKILL.md")) return true;
      return undefined;
    });
    await install("debug", { from: "a/repo" });
    expect(mockRmSync).toHaveBeenCalledWith(
      expect.stringContaining("debug"),
      expect.objectContaining({ recursive: true }),
    );
    expect(mockCpSync).toHaveBeenCalled();
    existsSpy.mockRestore();
  });
});

// ── copySkillFromCache — DESIGN.md fallback ─────────────────────────────────

describe("copySkillFromCache — DESIGN.md fallback", () => {
  it("installs a skill from DESIGN.md when no SKILL.md exists", async () => {
    const source = makeSource({
      url: "a/design-repo",
      skillsInstalled: [],
      availableItems: [{ name: "design-linear", description: "", type: "skill" }],
    });
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    mockGetSourceCachePath.mockReturnValue("/cache/a_design-repo");
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    existsSpy.mockImplementation((path) => {
      const stringPath = String(path);
      if (stringPath.endsWith("SKILL.md")) return false;
      if (stringPath === "/cache/a_design-repo") return true;
      if (stringPath === "/cache/a_design-repo/design-linear") return true;
      if (stringPath.includes("/cache/a_design-repo/design-linear/DESIGN.md")) return true;
      return false;
    });
    await install("design-linear", { from: "a/design-repo" });
    expect(mockCpSync).toHaveBeenCalled();
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("installed");
    existsSpy.mockRestore();
  });
});

// ── copySkillFromCache — single-skill repo (root SKILL.md) ──────────────────

describe("copySkillFromCache — single-skill repo fallback", () => {
  it("installs a skill from cachePath itself when SKILL.md lives at the repo root", async () => {
    // browser-use/browser-harness layout: SKILL.md sits at the repo root and
    // there is NO `<cache>/<skillName>/` enclosing dir. Without the fallback
    // the install short-circuits to trySourceFallback and the staging dir
    // never gets the skill, breaking `agentbrew install <root-level-skill>`.
    const source = makeSource({
      url: "browser-use/browser-harness",
      skillsInstalled: [],
      availableItems: [{ name: "browser-harness", description: "", type: "skill" }],
    });
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    mockGetSourceCachePath.mockReturnValue("/cache/browser-use_browser-harness");
    const findSpy = vi
      .spyOn(await import("./index-source.js"), "findSkillDirInCache")
      .mockReturnValue("/cache/browser-use_browser-harness");
    await install("browser-harness", { from: "browser-use/browser-harness" });
    // The fallback copies from the cache root, not from a non-existent
    // <cache>/<skillName>/ subdir.
    expect(mockCpSync).toHaveBeenCalledWith(
      "/cache/browser-use_browser-harness",
      expect.stringContaining("browser-harness"),
      expect.objectContaining({ recursive: true }),
    );
    findSpy.mockRestore();
  });
});

// ── copySkillFromCache — fs failures before state update ─────────────────────

describe("copySkillFromCache — fs failures before state update", () => {
  it("does not save state when rmSync throws while removing stale destination", async () => {
    const source = makeSource({
      url: "a/repo",
      skillsInstalled: [],
      availableItems: [{ name: "debug", description: "", type: "skill" }],
    });
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    mockGetSourceCachePath.mockReturnValue("/cache/a_repo");
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    mockSkillCacheExists(existsSpy, "/cache/a_repo", "debug", (stringPath) => {
      if (stringPath.includes("installed-skills/debug") && !stringPath.endsWith("SKILL.md")) return true;
      return undefined;
    });
    mockRmSync.mockImplementationOnce(() => {
      throw new Error("rm failed");
    });
    await expect(install("debug", { from: "a/repo" })).rejects.toThrow("rm failed");
    expect(mockSaveState).not.toHaveBeenCalled();
    expect(mockLockSource).not.toHaveBeenCalled();
    existsSpy.mockRestore();
  });

  it("does not save state when mkdirSync throws after stale removal", async () => {
    const source = makeSource({
      url: "a/repo",
      skillsInstalled: [],
      availableItems: [{ name: "debug", description: "", type: "skill" }],
    });
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    mockGetSourceCachePath.mockReturnValue("/cache/a_repo");
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    mockSkillCacheExists(existsSpy, "/cache/a_repo", "debug");
    mockMkdirSync.mockImplementationOnce(() => {
      throw new Error("mkdir failed");
    });
    await expect(install("debug", { from: "a/repo" })).rejects.toThrow("mkdir failed");
    expect(mockSaveState).not.toHaveBeenCalled();
    expect(mockLockSource).not.toHaveBeenCalled();
    existsSpy.mockRestore();
  });
});

// ── installSkill — built-in source short-circuit ─────────────────────────────

describe("installSkill — built-in source", () => {
  it("does not copy to installed-skills when source is built-in", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [
        {
          name: "next-task",
          description: "Next Task",
          source: "built-in",
          category: "task-management",
          recommended: true,
        },
      ],
      mcp_servers: [],
      rules: [],
      cli_tools: [],
    });
    mockLoadState.mockReturnValue(makeState());

    await install("next-task");

    expect(mockCpSync).not.toHaveBeenCalled();
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("already installed (skipped)");
  });

  it("catalog next-task entry uses built-in source (not remote GitHub)", async () => {
    // Restore real catalog to verify the actual catalog.yaml entry
    const { loadCatalog: realLoadCatalog } = await vi.importActual<typeof import("./types.js")>("./types.js");
    const catalog = realLoadCatalog();
    const nextTask = catalog.skills.find((s) => s.name === "next-task");
    expect(nextTask).toBeDefined();
    expect(nextTask?.source).toBe("built-in");
  });
});

// ── installSkill — already-installed path ───────────────────────────────────

describe("installSkill — already-installed idempotency", () => {
  it("reports already installed when skill dir exists in installed-skills", async () => {
    // test-driven-development is a catalog skill (source: obra/superpowers)
    mockLoadState.mockReturnValue(
      makeState({
        sources: [
          makeSource({
            url: "obra/superpowers",
            skillsInstalled: ["test-driven-development"],
            availableItems: [],
          }),
        ],
      }),
    );
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync").mockReturnValue(true);
    await install("test-driven-development");
    expect(mockCpSync).not.toHaveBeenCalled();
    // "already installed" is batched — flush to print summary
    flushInstallSummary();
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("already installed");
    existsSpy.mockRestore();
  });
});

// ── installSkill — partial install (tracked but destination missing) ──────────

describe("installSkill — partial install (catalog source)", () => {
  it("recopies when skillsInstalled lists the skill but installed-skills dir is missing", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [
        {
          name: "test-driven-development",
          description: "TDD skill",
          source: "obra/superpowers",
          category: "testing",
          recommended: false,
        },
      ],
      mcp_servers: [],
      rules: [],
      cli_tools: [],
    });
    mockLoadState.mockReturnValue(
      makeState({
        sources: [
          makeSource({
            url: "obra/superpowers",
            skillsInstalled: ["test-driven-development"],
            availableItems: [],
          }),
        ],
      }),
    );
    mockGetSourceCachePath.mockReturnValue("/cache/obra_superpowers");
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    mockSkillCacheExists(existsSpy, "/cache/obra_superpowers", "test-driven-development");
    await install("test-driven-development");
    expect(mockCpSync).toHaveBeenCalled();
    existsSpy.mockRestore();
  });
});

// ── ensureInstalledSkillsRegistered — auto-registration ─────────────────────

describe("ensureInstalledSkillsRegistered — auto-registration after install", () => {
  it("registers installed-skills dir in skillSourceDirs after catalog skill install", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [
        {
          name: "test-driven-development",
          description: "TDD skill",
          source: "obra/superpowers",
          category: "testing",
          recommended: false,
        },
      ],
      mcp_servers: [],
      rules: [],
      cli_tools: [],
    });
    const state = makeState({ sources: [] });
    mockLoadState.mockReturnValue(state);
    mockGetSourceCachePath.mockReturnValue("/cache/obra_superpowers");
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    mockSkillCacheExists(existsSpy, "/cache/obra_superpowers", "test-driven-development");
    await install("test-driven-development");

    // saveState should have been called with skillSourceDirs containing installed-skills
    expect(mockSaveState).toHaveBeenCalled();
    const savedState = mockSaveState.mock.calls.at(-1)?.[0];
    expect(savedState?.skillSourceDirs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "installed-skills", path: "~/.config/agentbrew/installed-skills" }),
      ]),
    );
    existsSpy.mockRestore();
  });

  it("does not duplicate skillSourceDir entry when installed-skills is already registered", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [
        {
          name: "test-driven-development",
          description: "TDD skill",
          source: "obra/superpowers",
          category: "testing",
          recommended: false,
        },
      ],
      mcp_servers: [],
      rules: [],
      cli_tools: [],
    });
    const state = makeState({
      sources: [],
      skillSourceDirs: [{ label: "installed-skills", path: "~/.config/agentbrew/installed-skills" }],
    });
    mockLoadState.mockReturnValue(state);
    mockGetSourceCachePath.mockReturnValue("/cache/obra_superpowers");
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    mockSkillCacheExists(existsSpy, "/cache/obra_superpowers", "test-driven-development");
    await install("test-driven-development");

    // Should NOT add a duplicate entry
    expect(mockSaveState).toHaveBeenCalled();
    const savedState = mockSaveState.mock.calls.at(-1)?.[0];
    const installedSkillEntries = (savedState?.skillSourceDirs ?? []).filter(
      (d: { path: string }) => d.path === "~/.config/agentbrew/installed-skills",
    );
    expect(installedSkillEntries).toHaveLength(1);
    existsSpy.mockRestore();
  });
});

// ── installSkill — cachePath failure ────────────────────────────────────────

describe("installSkill — catalog skill fetch failure", () => {
  it("reports failure when cache path is unavailable for catalog skill", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockGetSourceCachePath.mockReturnValue(undefined);
    await install("test-driven-development");
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("Failed to fetch");
    expect(mockCpSync).not.toHaveBeenCalled();
  });

  it("does not save state when cache resolves but SKILL.md is missing from cache paths", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [
        {
          name: "orphan-skill",
          description: "No files in cache",
          source: "some/repo",
          category: "testing",
          recommended: false,
        },
      ],
      mcp_servers: [],
      rules: [],
      cli_tools: [],
    });
    mockLoadState.mockReturnValue(makeState());
    mockGetSourceCachePath.mockReturnValue("/cache/some_repo");
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync").mockReturnValue(false);
    await install("orphan-skill");
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("not found in");
    expect(mockSaveState).not.toHaveBeenCalled();
    expect(mockLockSource).not.toHaveBeenCalled();
    existsSpy.mockRestore();
  });
});

// ── installSkill — state tracking: new source push ─────────────────────────

describe("installSkill — state tracking for new source", () => {
  it("adds new source to state when catalog skill source not yet tracked", async () => {
    // State has no sources yet — install a catalog skill for the first time
    mockLoadState.mockReturnValue(makeState());
    mockGetSourceCachePath.mockReturnValue("/cache/obra_superpowers");
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    mockSkillCacheExists(existsSpy, "/cache/obra_superpowers", "test-driven-development");
    await install("test-driven-development");
    expect(mockSaveState).toHaveBeenCalled();
    const savedState = mockSaveState.mock.calls[0][0];
    expect((savedState.sources ?? []).length).toBeGreaterThan(0);
    existsSpy.mockRestore();
  });

  it("does not duplicate source when catalog skill source already tracked", async () => {
    const initialSource = makeSource({
      url: "obra/superpowers",
      skillsInstalled: [],
      availableItems: [],
    });
    mockLoadState.mockReturnValue(makeState({ sources: [initialSource] }));
    mockGetSourceCachePath.mockReturnValue("/cache/obra_superpowers");
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    mockSkillCacheExists(existsSpy, "/cache/obra_superpowers", "test-driven-development");
    await install("test-driven-development");
    expect(mockSaveState).toHaveBeenCalled();
    const savedState = mockSaveState.mock.calls[0][0];
    // Should still be exactly one source, not duplicated
    expect((savedState.sources ?? []).filter((s: Source) => s.url === "obra/superpowers")).toHaveLength(1);
    existsSpy.mockRestore();
  });
});

// ── install — not-found suggestion paths ────────────────────────────────────

describe("install — not-found fallback messages", () => {
  it("shows suggestion when formatSuggestion returns one", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockFormatSuggestion.mockReturnValue("Did you mean: debug?");
    await install("debgu");
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("Did you mean: debug?");
  });

  it("shows fallback catalog hint when no suggestion is found", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockFormatSuggestion.mockReturnValue(undefined);
    await install("zzzzunknown");
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("agentbrew catalog");
  });
});

// ── install — multi-source select prompt ────────────────────────────────────

describe("install — multiple sources prompt", () => {
  it("shows multi-source message when name found in multiple sources", async () => {
    const state = makeState({
      sources: [
        makeSource({
          url: "a/repo",
          availableItems: [{ name: "source-only-skill", description: "A version", type: "skill" }],
        }),
        makeSource({
          url: "b/repo",
          availableItems: [{ name: "source-only-skill", description: "B version", type: "skill" }],
        }),
      ],
    });
    mockLoadState.mockReturnValue(state);
    mockSelect.mockResolvedValue("a/repo");
    mockGetSourceCachePath.mockReturnValue(undefined); // skip actual install
    await install("source-only-skill");
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("found in");
    expect(logs).toContain("sources");
    expect(mockSelect).toHaveBeenCalled();
  });

  it("proceeds to install from chosen source after prompt", async () => {
    const state = makeState({
      sources: [
        makeSource({
          url: "a/repo",
          availableItems: [{ name: "source-only-skill", description: "A version", type: "skill" }],
        }),
        makeSource({
          url: "b/repo",
          availableItems: [{ name: "source-only-skill", description: "B version", type: "skill" }],
        }),
      ],
    });
    mockLoadState.mockReturnValue(state);
    mockSelect.mockResolvedValue("a/repo");
    mockGetSourceCachePath.mockReturnValue("/cache/a_repo");
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    mockSkillCacheExists(existsSpy, "/cache/a_repo", "source-only-skill");
    await install("source-only-skill");
    expect(mockCpSync).toHaveBeenCalled();
    existsSpy.mockRestore();
  });

  it("does not install when select returns a URL that does not match any source", async () => {
    const state = makeState({
      sources: [
        makeSource({
          url: "a/repo",
          availableItems: [{ name: "source-only-skill", description: "A version", type: "skill" }],
        }),
        makeSource({
          url: "b/repo",
          availableItems: [{ name: "source-only-skill", description: "B version", type: "skill" }],
        }),
      ],
    });
    mockLoadState.mockReturnValue(state);
    mockSelect.mockResolvedValue("unknown/repo");
    mockGetSourceCachePath.mockReturnValue("/cache/a_repo");
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    mockSkillCacheExists(existsSpy, "/cache/a_repo", "source-only-skill");
    await install("source-only-skill");
    expect(mockCpSync).not.toHaveBeenCalled();
    existsSpy.mockRestore();
  });
});

// ── install — no name (popular help) ─────────────────────────────────────────

describe("install — no name (popular help)", () => {
  it("prints popular skills, MCP servers, and install hints", async () => {
    mockLoadState.mockReturnValue(makeState());
    await install(undefined);
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("Popular skills");
    expect(logs).toMatch(/find-skills|debug/);
    expect(logs).toContain("Popular MCP");
    expect(logs).toContain("Install:");
    expect(logs).toContain("agentbrew install <name>");
    expect(logs).toContain("agentbrew install --recommended");
    expect(logs).toContain("agentbrew catalog");
  });

  it("adds an ellipsis when a description is truncated (never cuts mid-word without a marker)", async () => {
    // Regression: the Popular list used to emit
    //   `debug ★  Structured debugging — reproduce → isolate → hypothesize → f`
    // with the description cut mid-word and no indicator that there was more.
    // Truncated lines MUST end with "…" so users know there's more context and
    // can `agentbrew catalog show <name>` to read the full description.
    mockLoadState.mockReturnValue(makeState());
    await install(undefined);
    const logLines = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((args: unknown[]) => args.join(" "))
      .filter((line: string) => /[★]/.test(line));

    expect(logLines.length).toBeGreaterThan(0);
    // For every ★ line, strip ANSI codes and find the catalog entry that line
    // came from; if the printed description is shorter than the catalog's full
    // description, a truncation happened and "…" must be the last character.
    const catalog = loadCatalog();
    for (const line of logLines) {
      const plain = line.replace(/\u001b\[[0-9;]*m/g, "").trimEnd();
      // Extract the skill/server name (first token after leading spaces)
      const nameMatch = plain.match(/^\s+(\S+)\s+★/);
      if (!nameMatch) continue;
      const name = nameMatch[1];
      const item = catalog.skills.find((s) => s.name === name) ?? catalog.mcp_servers.find((s) => s.name === name);
      if (!item) continue;
      // The description portion of the printed line comes after "★  "
      const printedDesc = plain.slice(plain.indexOf("★") + 2).trim();
      if (printedDesc.length < item.description.length) {
        expect(printedDesc.endsWith("…")).toBe(true);
      }
    }
  });
});

// ── installRecommended — cli_tools and rules ────────────────────────────────

describe("installRecommended", () => {
  it("does not mutate state, rules, or command files during dry run", async () => {
    const { loadSharedRules, saveSharedRules } = await import("../sync/rules-sync.js");
    vi.mocked(loadSharedRules).mockReturnValue("# Existing\n");
    mockLoadState.mockReturnValue(makeState());
    mockGetSourceCachePath.mockReturnValue("/cache/dry");
    mockLoadCatalog.mockReturnValue({
      skills: [
        {
          name: "dry-skill",
          description: "Dry-run skill",
          category: "testing",
          source: "owner/repo",
          recommended: true,
        },
      ],
      mcp_servers: [
        {
          name: "dry-mcp",
          description: "Dry-run MCP",
          category: "testing",
          command: "node",
          args: ["server.js"],
          recommended: true,
          smokeCall: { tool: "ping" },
        },
      ],
      rules: [
        {
          name: "dry-rule",
          description: "Dry-run rule",
          category: "testing",
          content: "Run checks before committing.",
          recommended: true,
        },
      ],
      cli_tools: [
        {
          name: "dry-tool",
          description: "Dry-run CLI tool",
          category: "testing",
          commands: ["dry-command"],
          recommended: true,
        },
      ],
    });
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    existsSpy.mockImplementation((path) => {
      const stringPath = String(path);
      if (stringPath === "/cache/dry/dry-skill/SKILL.md") return true;
      if (stringPath.includes("cli-commands/dry-tool")) return true;
      if (stringPath.endsWith("dry-command.md")) return true;
      return false;
    });

    await install(undefined, { recommended: true, dryRun: true });

    expect(mockGetSourceCachePath).not.toHaveBeenCalled();
    expect(mockCpSync).not.toHaveBeenCalled();
    expect(mockSaveState).not.toHaveBeenCalled();
    expect(mockAddMcpServer).not.toHaveBeenCalled();
    expect(mockAddToAgentfile).not.toHaveBeenCalled();
    expect(saveSharedRules).not.toHaveBeenCalled();
    expect(mockWriteFileAtomicSync).not.toHaveBeenCalled();
    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Dry run"));
    existsSpy.mockRestore();
  });

  it("does not re-add a recommended MCP server the user removed", async () => {
    mockLoadState.mockReturnValue({ ...makeState(), declinedMcpServers: ["declined-mcp"] });
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [
        { name: "declined-mcp", description: "Removed", category: "testing", command: "node", recommended: true },
        { name: "wanted-mcp", description: "Kept", category: "testing", command: "node", recommended: true },
      ],
      rules: [],
      cli_tools: [],
    });
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync").mockReturnValue(false);

    await install(undefined, { recommended: true });

    const added = mockAddMcpServer.mock.calls.map((call) => call[0]);
    expect(added).toContain("wanted-mcp");
    expect(added).not.toContain("declined-mcp");
    existsSpy.mockRestore();
  });

  it("installs recommended cli tools alongside skills and mcp servers", async () => {
    mockLoadState.mockReturnValue(makeState());
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync").mockReturnValue(false);
    await install(undefined, { recommended: true });
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("Recommended setup complete");
    existsSpy.mockRestore();
  });

  it("installs recommended rules and reports status when shared-rules.md exists", async () => {
    const { loadSharedRules, saveSharedRules } = await import("../sync/rules-sync.js");
    vi.mocked(loadSharedRules).mockReturnValue("# Existing\n");
    mockLoadState.mockReturnValue(makeState());
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync").mockReturnValue(false);
    mockGetSourceCachePath.mockReturnValue(undefined); // skip skill fetch
    await install(undefined, { recommended: true });
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("Rules");
    expect(vi.mocked(saveSharedRules)).toHaveBeenCalled();
    existsSpy.mockRestore();
  });

  it("reports skipped for rules when no shared-rules.md exists during recommended install", async () => {
    const { loadSharedRules } = await import("../sync/rules-sync.js");
    vi.mocked(loadSharedRules).mockReturnValue(undefined);
    mockLoadState.mockReturnValue(makeState());
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync").mockReturnValue(false);
    mockGetSourceCachePath.mockReturnValue(undefined);
    await install(undefined, { recommended: true });
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("skipped");
    existsSpy.mockRestore();
  });

  it("reports already-present only when another rule is also pending in the same run", async () => {
    const { loadSharedRules } = await import("../sync/rules-sync.js");
    // Dedup is marker-based (see `addRuleToSharedRules` in install-other.ts):
    // if `<!-- rule: <name> -->` is anywhere in the file, we treat it as
    // installed regardless of whether the body matches. Issue 2 of
    // `sync-idempotent-and-complete` suppresses the Rules section when
    // every rule is already-present — so to observe the "already in
    // shared-rules.md" line we include a second pending rule.
    const oldRuleBody =
      "Use conventional commits: feat:, fix:, docs:, refactor:, test:, chore:\nHeader must be ≤72 characters.\nInclude ticket number at end when available.";
    const newRuleBody = "Run tests before committing.";
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [],
      rules: [
        {
          name: "conventional-commits",
          description: "Conventional commits rule",
          category: "git",
          recommended: true,
          content: oldRuleBody,
        },
        {
          name: "test-before-commit",
          description: "Test before commit rule",
          category: "git",
          recommended: true,
          content: newRuleBody,
        },
      ],
      cli_tools: [],
    });
    vi.mocked(loadSharedRules).mockReturnValue(`# Rules\n\n<!-- rule: conventional-commits -->\n${oldRuleBody}\n`);
    mockLoadState.mockReturnValue(makeState());
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync").mockReturnValue(false);
    await install(undefined, { recommended: true });
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    // Pending rule prints the "added" line; the already-present rule is
    // skipped entirely now that `installRecommended` only iterates pending
    // entries. Disambiguated wording from `status-numbers-self-consistent`:
    // rule snippets in `shared-rules.md` (source-of-truth) vs stale managed
    // sections in agent-side rule files.
    expect(logs).toContain("added to shared-rules.md");
    expect(logs).toContain("test-before-commit");
    // The already-present marker is not re-advertised; silent skip is the
    // no-op sync contract (issue 2 of `sync-idempotent-and-complete`).
    expect(logs).not.toContain("conventional-commits — already in shared-rules.md");
    existsSpy.mockRestore();
  });

  it("returns silently when every recommended rule is already-present and no other sections have pending work", async () => {
    // When EVERY recommended item is already installed/present, the
    // header, the per-category listings, each installer, the Rules
    // section, and the footer are ALL suppressed — `installRecommended`
    // becomes a no-op print. This is issue 2 of
    // `sync-idempotent-and-complete`: a no-op sync must be a no-op.
    const { loadSharedRules } = await import("../sync/rules-sync.js");
    const ruleBody = "Use conventional commits: feat:, fix:, docs:, refactor:, test:, chore:";
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [],
      rules: [
        {
          name: "conventional-commits",
          description: "Conventional commits rule",
          category: "git",
          recommended: true,
          content: ruleBody,
        },
      ],
      cli_tools: [],
    });
    vi.mocked(loadSharedRules).mockReturnValue(`# Rules\n\n<!-- rule: conventional-commits -->\n${ruleBody}\n`);
    mockLoadState.mockReturnValue(makeState());
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync").mockReturnValue(false);
    await install(undefined, { recommended: true });
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).not.toContain("Installing recommended items:");
    expect(logs).not.toContain("Recommended setup complete");
    expect(logs).not.toContain("conventional-commits");
    existsSpy.mockRestore();
  });
});

// ── install — --from option validation (lines 59–71) ─────────────────────────

describe("install — --from option validation", () => {
  it("warns when the requested source URL is not in state", async () => {
    const source = makeSource({
      url: "a/repo",
      skillsInstalled: [],
      availableItems: [{ name: "debug", description: "", type: "skill" }],
    });
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    await install("debug", { from: "other/repo" });
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("'other/repo' not found in registered sources");
    expect(mockCpSync).not.toHaveBeenCalled();
  });

  it("warns when the skill is not listed in the source availableItems", async () => {
    const source = makeSource({
      url: "a/repo",
      skillsInstalled: [],
      availableItems: [{ name: "debug", description: "", type: "skill" }],
    });
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    await install("missing-skill", { from: "a/repo" });
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("'missing-skill' not found in source 'a/repo'");
    expect(mockCpSync).not.toHaveBeenCalled();
  });
});

// ── installFromSource — GHE vs public failure messages ──────────────────────

describe("installFromSource — failure messages by URL type", () => {
  it("shows GHE auth hint when source URL is a GitHub Enterprise host", async () => {
    const source = makeSource({
      url: "github.example.com/team/skills",
      skillsInstalled: [],
      availableItems: [{ name: "debug", description: "", type: "skill" }],
    });
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    mockGetSourceCachePath.mockReturnValue(undefined);
    await install("debug", { from: "github.example.com/team/skills" });
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("GHE authentication");
  });

  it("shows internet connection hint when source URL is a public GitHub repo", async () => {
    const source = makeSource({
      url: "some-public/repo",
      skillsInstalled: [],
      availableItems: [{ name: "debug", description: "", type: "skill" }],
    });
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    mockGetSourceCachePath.mockReturnValue(undefined);
    await install("debug", { from: "some-public/repo" });
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("internet connection");
  });

  it("shows skill-not-found error when cache exists but SKILL.md is absent", async () => {
    const source = makeSource({
      url: "a/repo",
      skillsInstalled: [],
      availableItems: [{ name: "missing-skill", description: "", type: "skill" }],
    });
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    mockGetSourceCachePath.mockReturnValue("/cache/a_repo");
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync").mockReturnValue(false);
    await install("missing-skill", { from: "a/repo" });
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("not found in");
    expect(logs).toContain("sync --pull");
    expect(mockSaveState).not.toHaveBeenCalled();
    expect(mockLockSource).not.toHaveBeenCalled();
    existsSpy.mockRestore();
  });

  it("does not update state when cache path is unavailable in installFromSource", async () => {
    const source = makeSource({
      url: "a/repo",
      skillsInstalled: [],
      availableItems: [{ name: "debug", description: "", type: "skill" }],
    });
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    mockGetSourceCachePath.mockReturnValue(undefined);
    await install("debug", { from: "a/repo" });
    expect(mockSaveState).not.toHaveBeenCalled();
    expect(mockLockSource).not.toHaveBeenCalled();
  });
});

// ── installSkill — GHE auth hint for catalog skill ───────────────────────────

describe("installSkill — GHE auth hint for internal source", () => {
  it("shows GHE hint when catalog skill source is an internal URL", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [
        {
          name: "internal-skill",
          description: "Internal skill",
          source: "https://github.corp.example.com/devx/skills",
          category: "internal",
          recommended: false,
        },
      ],
      mcp_servers: [],
      rules: [],
      cli_tools: [],
    });
    mockLoadState.mockReturnValue(makeState());
    mockGetSourceCachePath.mockReturnValue(undefined);
    await install("internal-skill");
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("GHE authentication");
    expect(mockSaveState).not.toHaveBeenCalled();
  });
});

// ── installSkill — lock logging when lockSource returns entry ────────────────

describe("installSkill — lock logging", () => {
  it("logs lock sha when catalog skill install succeeds and lockSource returns entry", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [
        {
          name: "test-driven-development",
          description: "TDD skill",
          source: "obra/superpowers",
          category: "testing",
          recommended: false,
        },
      ],
      mcp_servers: [],
      rules: [],
      cli_tools: [],
    });
    mockLoadState.mockReturnValue(makeState());
    mockGetSourceCachePath.mockReturnValue("/cache/obra_superpowers");
    mockLockSource.mockReturnValue({
      sha: "deadbeef1234",
      skills: ["test-driven-development"],
      source: "obra/superpowers",
      type: "github",
      lockedAt: "",
    });
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    mockSkillCacheExists(existsSpy, "/cache/obra_superpowers", "test-driven-development");
    await install("test-driven-development");
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("Locked");
    expect(logs).toContain("deadbeef");
    existsSpy.mockRestore();
  });

  it("does not log lock sha when lockSource returns undefined for catalog skill", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [
        {
          name: "test-driven-development",
          description: "TDD skill",
          source: "obra/superpowers",
          category: "testing",
          recommended: false,
        },
      ],
      mcp_servers: [],
      rules: [],
      cli_tools: [],
    });
    mockLoadState.mockReturnValue(makeState());
    mockGetSourceCachePath.mockReturnValue("/cache/obra_superpowers");
    mockLockSource.mockReturnValue(undefined);
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    mockSkillCacheExists(existsSpy, "/cache/obra_superpowers", "test-driven-development");
    await install("test-driven-development");
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).not.toContain("Locked");
    existsSpy.mockRestore();
  });
});

// ── lock / "version" semantics — lockSource merge/SHA update ────────────────

describe("lock / lockSource integration — version update semantics", () => {
  it("calls lockSource with correct source and skill name after successful install", async () => {
    const source = makeSource({
      url: "a/repo",
      skillsInstalled: [],
      availableItems: [{ name: "debug", description: "", type: "skill" }],
    });
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    mockGetSourceCachePath.mockReturnValue("/cache/a_repo");
    mockLockSource.mockReturnValue({
      sha: "sha1111111111",
      skills: ["debug"],
      source: "a/repo",
      type: "github",
      lockedAt: "",
    });
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    mockSkillCacheExists(existsSpy, "/cache/a_repo", "debug");
    await install("debug", { from: "a/repo" });
    expect(mockLockSource).toHaveBeenCalledWith(
      expect.objectContaining({ url: "a/repo" }),
      expect.arrayContaining(["debug"]),
    );
    existsSpy.mockRestore();
  });

  it("lockSource called again on repeated install — documenting merge/overwrite behavior", async () => {
    // Simulate a reinstall: skill already listed in skillsInstalled but dir is missing (partial)
    const source = makeSource({
      url: "a/repo",
      skillsInstalled: [],
      availableItems: [{ name: "debug", description: "", type: "skill" }],
    });
    const state = makeState({ sources: [source] });
    mockLoadState.mockReturnValue(state);
    mockGetSourceCachePath.mockReturnValue("/cache/a_repo");
    mockLockSource.mockReturnValue({
      sha: "sha2222222222",
      skills: ["debug"],
      source: "a/repo",
      type: "github",
      lockedAt: "",
    });
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    mockSkillCacheExists(existsSpy, "/cache/a_repo", "debug");

    // First install
    await install("debug", { from: "a/repo" });
    const firstCallCount = mockLockSource.mock.calls.length;

    // Reset state mock to simulate new call (skill not yet in installed list for source)
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetSourceCachePath.mockReturnValue("/cache/a_repo");
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    mockLockSource.mockReturnValue({
      sha: "sha3333333333",
      skills: ["debug"],
      source: "a/repo",
      type: "github",
      lockedAt: "",
    });

    // Second install (same skill)
    await install("debug", { from: "a/repo" });
    expect(mockLockSource).toHaveBeenCalledTimes(1); // once per invocation
    expect(firstCallCount).toBe(1);
    existsSpy.mockRestore();
  });

  it("sequential installs of different skills from the same catalog source invoke lockSource for each skill (lock/version line updates)", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [
        {
          name: "skill-one",
          description: "One",
          source: "shared/catalog-repo",
          category: "testing",
          recommended: false,
        },
        {
          name: "skill-two",
          description: "Two",
          source: "shared/catalog-repo",
          category: "testing",
          recommended: false,
        },
      ],
      mcp_servers: [],
      rules: [],
      cli_tools: [],
    });
    const sharedSource = makeSource({
      url: "shared/catalog-repo",
      skillsInstalled: [],
      availableItems: [],
    });
    mockLoadState.mockReturnValue(makeState({ sources: [sharedSource] }));
    mockGetSourceCachePath.mockReturnValue("/cache/shared_catalog_repo");
    mockLockSource.mockImplementation(() => ({
      sha: "vers1111111111",
      skills: [],
      source: "shared/catalog-repo",
      type: "github",
      lockedAt: "",
    }));
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    existsSpy.mockImplementation((path) => {
      const stringPath = String(path);
      if (stringPath === "/cache/shared_catalog_repo") return true;
      if (stringPath === "/cache/shared_catalog_repo/skills/skill-one") return true;
      if (stringPath === "/cache/shared_catalog_repo/skills/skill-two") return true;
      return (
        stringPath.includes("/cache/shared_catalog_repo/skills/skill-one/SKILL.md") ||
        stringPath.includes("/cache/shared_catalog_repo/skills/skill-two/SKILL.md")
      );
    });

    await install("skill-one");
    await install("skill-two");

    expect(mockLockSource).toHaveBeenNthCalledWith(1, expect.objectContaining({ url: "shared/catalog-repo" }), [
      "skill-one",
    ]);
    expect(mockLockSource).toHaveBeenNthCalledWith(2, expect.objectContaining({ url: "shared/catalog-repo" }), [
      "skill-two",
    ]);
    existsSpy.mockRestore();
  });
});

// ── partial install — skill listed in skillsInstalled but dir missing ─────────

describe("installFromSource — partial install (listed but dir missing)", () => {
  it("reinstalls when skill is in skillsInstalled but destination dir is missing", async () => {
    const source = makeSource({
      url: "a/repo",
      skillsInstalled: ["debug"],
      availableItems: [{ name: "debug", description: "", type: "skill" }],
    });
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    mockGetSourceCachePath.mockReturnValue("/cache/a_repo");
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    mockSkillCacheExists(existsSpy, "/cache/a_repo", "debug");
    await install("debug", { from: "a/repo" });
    // cpSync should fire since the destination was missing despite being in skillsInstalled
    expect(mockCpSync).toHaveBeenCalled();
    existsSpy.mockRestore();
  });

  it("does not reinstall when skill in skillsInstalled AND destination dir exists", async () => {
    const source = makeSource({
      url: "a/repo",
      skillsInstalled: ["debug"],
      availableItems: [{ name: "debug", description: "", type: "skill" }],
    });
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    // existsSync returns true for the destination dir (already fully installed)
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync").mockReturnValue(true);
    await install("debug", { from: "a/repo" });
    expect(mockCpSync).not.toHaveBeenCalled();
    // "already installed" is batched — flush to print summary
    flushInstallSummary();
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("already installed");
    existsSpy.mockRestore();
  });

  it("does not call saveState when cache path is missing during reinstall", async () => {
    const source = makeSource({
      url: "a/repo",
      skillsInstalled: ["debug"],
      availableItems: [{ name: "debug", description: "", type: "skill" }],
    });
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    mockGetSourceCachePath.mockReturnValue(undefined);
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync").mockReturnValue(false);
    await install("debug", { from: "a/repo" });
    expect(mockSaveState).not.toHaveBeenCalled();
    expect(mockLockSource).not.toHaveBeenCalled();
    existsSpy.mockRestore();
  });
});

// ── cleanup on failure — cpSync throws ──────────────────────────────────────

describe("cleanup on failure — cpSync throws", () => {
  it("does not call saveState or lockSource when cpSync throws during installFromSource", async () => {
    const source = makeSource({
      url: "a/repo",
      skillsInstalled: [],
      availableItems: [{ name: "debug", description: "", type: "skill" }],
    });
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    mockGetSourceCachePath.mockReturnValue("/cache/a_repo");
    mockCpSync.mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    mockSkillCacheExists(existsSpy, "/cache/a_repo", "debug");
    await expect(install("debug", { from: "a/repo" })).rejects.toThrow("disk full");
    expect(mockSaveState).not.toHaveBeenCalled();
    expect(mockLockSource).not.toHaveBeenCalled();
    existsSpy.mockRestore();
  });

  it("does not call saveState or lockSource when cpSync throws during installSkill", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [
        {
          name: "test-driven-development",
          description: "TDD skill",
          source: "obra/superpowers",
          category: "testing",
          recommended: false,
        },
      ],
      mcp_servers: [],
      rules: [],
      cli_tools: [],
    });
    mockLoadState.mockReturnValue(makeState());
    mockGetSourceCachePath.mockReturnValue("/cache/obra_superpowers");
    mockCpSync.mockImplementationOnce(() => {
      throw new Error("permission denied");
    });
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    mockSkillCacheExists(existsSpy, "/cache/obra_superpowers", "test-driven-development");
    await expect(install("test-driven-development")).rejects.toThrow("permission denied");
    expect(mockSaveState).not.toHaveBeenCalled();
    expect(mockLockSource).not.toHaveBeenCalled();
    existsSpy.mockRestore();
  });
});

// ── concurrent installs — no duplicated state ────────────────────────────────

describe("concurrent installs — parallel Promise.all", () => {
  it("concurrent installs of different skills do not corrupt state", async () => {
    const sourceA = makeSource({
      url: "a/repo",
      skillsInstalled: [],
      availableItems: [
        { name: "skill-alpha", description: "", type: "skill" },
        { name: "skill-beta", description: "", type: "skill" },
      ],
    });
    const state = makeState({ sources: [sourceA] });
    mockLoadState.mockReturnValue(state);
    mockGetSourceCachePath.mockReturnValue("/cache/a_repo");
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    existsSpy.mockImplementation((path) => {
      const stringPath = String(path);
      if (stringPath === "/cache/a_repo") return true;
      if (stringPath === "/cache/a_repo/skills/skill-alpha") return true;
      if (stringPath === "/cache/a_repo/skills/skill-beta") return true;
      return (
        stringPath.includes("/cache/a_repo/skills/skill-alpha/SKILL.md") ||
        stringPath.includes("/cache/a_repo/skills/skill-beta/SKILL.md")
      );
    });

    await Promise.all([install("skill-alpha", { from: "a/repo" }), install("skill-beta", { from: "a/repo" })]);

    // Both installs should have completed (cpSync called twice)
    expect(mockCpSync).toHaveBeenCalledTimes(2);
    // Each should have saved state
    expect(mockSaveState).toHaveBeenCalledTimes(2);
    existsSpy.mockRestore();
  });

  it("concurrent installs of the same skill from the same source both complete", async () => {
    const source = makeSource({
      url: "a/repo",
      skillsInstalled: [],
      availableItems: [{ name: "debug", description: "", type: "skill" }],
    });
    const state = makeState({ sources: [source] });
    mockLoadState.mockReturnValue(state);
    mockGetSourceCachePath.mockReturnValue("/cache/a_repo");
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    mockSkillCacheExists(existsSpy, "/cache/a_repo", "debug");

    // Both installs should complete without throwing
    await expect(
      Promise.all([install("debug", { from: "a/repo" }), install("debug", { from: "a/repo" })]),
    ).resolves.not.toThrow();
    existsSpy.mockRestore();
  });

  it("concurrent different-skill installs persist both skill names on the shared source in saved state", async () => {
    const sourceA = makeSource({
      url: "a/repo",
      skillsInstalled: [],
      availableItems: [
        { name: "skill-alpha", description: "", type: "skill" },
        { name: "skill-beta", description: "", type: "skill" },
      ],
    });
    const state = makeState({ sources: [sourceA] });
    mockLoadState.mockReturnValue(state);
    mockGetSourceCachePath.mockReturnValue("/cache/a_repo");
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    existsSpy.mockImplementation((path) => {
      const stringPath = String(path);
      if (stringPath === "/cache/a_repo") return true;
      if (stringPath === "/cache/a_repo/skills/skill-alpha") return true;
      if (stringPath === "/cache/a_repo/skills/skill-beta") return true;
      return (
        stringPath.includes("/cache/a_repo/skills/skill-alpha/SKILL.md") ||
        stringPath.includes("/cache/a_repo/skills/skill-beta/SKILL.md")
      );
    });

    await Promise.all([install("skill-alpha", { from: "a/repo" }), install("skill-beta", { from: "a/repo" })]);

    const lastSave = mockSaveState.mock.calls[mockSaveState.mock.calls.length - 1]?.[0];
    const tracked = (lastSave?.sources ?? []).find((s: Source) => s.url === "a/repo");
    expect(tracked?.skillsInstalled).toEqual(expect.arrayContaining(["skill-alpha", "skill-beta"]));
    existsSpy.mockRestore();
  });
});

// ── installRule — no shared-rules.md (lines 349-351) ────────────────────────

describe("installRule — no shared-rules.md path", () => {
  it("shows raw rule content and instructions when no shared-rules.md exists", async () => {
    mockLoadState.mockReturnValue(makeState());
    const { loadSharedRules } = await import("../sync/rules-sync.js");
    vi.mocked(loadSharedRules).mockReturnValue(undefined);
    await install("conventional-commits");
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("No shared rules file found");
    expect(logs).toContain("agentbrew rules init");
  });

  it("adds rule separator and content when shared-rules.md exists but rule is absent", async () => {
    mockLoadState.mockReturnValue(makeState());
    const { loadSharedRules, saveSharedRules } = await import("../sync/rules-sync.js");
    vi.mocked(loadSharedRules).mockReturnValue("# Existing rules\n");
    await install("conventional-commits");
    const saved = vi.mocked(saveSharedRules).mock.calls[0]?.[0];
    expect(saved).toContain("<!-- rule: conventional-commits -->");
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("added to shared-rules.md");
    expect(logs).toContain("agentbrew sync --only rules");
  });
});

// ── installRecommended — cli tools logged (line 446) ────────────────────────

describe("installRecommended — CLI tools section listing", () => {
  it("logs CLI tools list when recommended catalog includes cli_tools with pending commands", async () => {
    mockLoadState.mockReturnValue(makeState());
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [],
      rules: [],
      cli_tools: [
        {
          name: "fake-tool",
          description: "A fake tool",
          category: "dev",
          recommended: true,
          // Must have at least one command so the pending pre-check sees
          // work to do — a tool with empty commands is trivially "already
          // installed" per the slice-3c `areCliToolCommandsInstalled`
          // helper (vacuous `.every()`), and would be suppressed.
          commands: ["fake-command"],
        },
      ],
    });
    // existsSync → false means the command file is NOT already on disk.
    // `areCliToolCommandsInstalled` returns false, so `pending.cliTools`
    // contains fake-tool and the CLI tools section is printed.
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync").mockReturnValue(false);
    await install(undefined, { recommended: true });
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("CLI tools");
    expect(logs).toContain("fake-tool");
    existsSpy.mockRestore();
  });
});

// ── install — dryRun option for CLI tool (line 113) ─────────────────────────

describe("install — dryRun option for CLI tool", () => {
  it("prints dry-run message and returns without installing when dryRun is true", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [],
      rules: [],
      cli_tools: [
        {
          name: "fake-tool",
          description: "A fake tool",
          category: "dev",
          recommended: false,
          commands: [],
        },
      ],
    });
    mockLoadState.mockReturnValue(makeState());
    await install("fake-tool", { dryRun: true });
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("Dry run");
    expect(logs).toContain("Would install CLI tool");
    expect(logs).toContain("fake-tool");
    // Nothing should actually be written
    expect(mockCpSync).not.toHaveBeenCalled();
    expect(mockSaveState).not.toHaveBeenCalled();
  });
});

// ── install — dryRun for catalog skill (lines 81-85) ─────────────────────────

describe("install — dryRun option for catalog skill", () => {
  it("prints dry-run message and returns without copying when dryRun is true", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [
        {
          name: "test-driven-development",
          description: "TDD skill",
          source: "obra/superpowers",
          category: "testing",
          recommended: false,
        },
      ],
      mcp_servers: [],
      rules: [],
      cli_tools: [],
    });
    mockLoadState.mockReturnValue(makeState());
    await install("test-driven-development", { dryRun: true });
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("Dry run");
    expect(logs).toContain("Would install skill");
    expect(logs).toContain("test-driven-development");
    expect(logs).toContain("obra/superpowers");
    expect(mockCpSync).not.toHaveBeenCalled();
    expect(mockSaveState).not.toHaveBeenCalled();
  });
});

// ── install — dryRun for MCP server (lines 90-97) ────────────────────────────

describe("install — dryRun option for MCP server", () => {
  it("prints dry-run message and returns without installing when dryRun is true", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [
        {
          name: "context7",
          description: "Context MCP server",
          command: "npx",
          args: ["-y", "@upstash/context7-mcp"],
          env: {},
          category: "productivity",
          recommended: false,
        },
      ],
      rules: [],
      cli_tools: [],
    });
    mockLoadState.mockReturnValue(makeState());
    await install("context7", { dryRun: true });
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("Dry run");
    expect(logs).toContain("Would install MCP server");
    expect(logs).toContain("context7");
    expect(mockAddMcpServer).not.toHaveBeenCalled();
    expect(mockSaveState).not.toHaveBeenCalled();
  });

  it("includes env keys in dry-run output when the MCP server declares env vars", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [
        {
          name: "context7",
          description: "Context MCP server",
          command: "npx",
          args: ["-y", "@upstash/context7-mcp"],
          env: { API_KEY: "secret", REGION: "us" },
          category: "productivity",
          recommended: false,
        },
      ],
      rules: [],
      cli_tools: [],
    });
    mockLoadState.mockReturnValue(makeState());
    await install("context7", { dryRun: true });
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("env:");
    expect(logs).toContain("API_KEY");
    expect(logs).toContain("REGION");
  });
});

// ── install — dryRun for rule (lines 102-105) ─────────────────────────────────

describe("install — dryRun option for rule", () => {
  it("prints dry-run message and returns without modifying shared-rules.md", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [],
      rules: [
        {
          name: "conventional-commits",
          description: "Commit format rules",
          content: "<!-- rule: conventional-commits -->\nUse conventional commits.",
          category: "git",
          recommended: false,
        },
      ],
      cli_tools: [],
    });
    mockLoadState.mockReturnValue(makeState());
    await install("conventional-commits", { dryRun: true });
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("Dry run");
    expect(logs).toContain("Would install rule");
    expect(logs).toContain("conventional-commits");
    const { saveSharedRules } = await import("../sync/rules-sync.js");
    expect(vi.mocked(saveSharedRules)).not.toHaveBeenCalled();
  });
});

// ── install — single source match from findInAllSources (line 120) ────────────

describe("install — single source match via findInAllSources", () => {
  it("installs directly when skill found in exactly one cached source without prompt", async () => {
    const source = makeSource({
      url: "a/repo",
      skillsInstalled: [],
      availableItems: [{ name: "unique-skill", description: "A unique skill", type: "skill" }],
    });
    // Empty catalog so no catalog match, but the source has the skill
    mockLoadCatalog.mockReturnValue({ skills: [], mcp_servers: [], rules: [], cli_tools: [] });
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    mockGetSourceCachePath.mockReturnValue("/cache/a_repo");
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    mockSkillCacheExists(existsSpy, "/cache/a_repo", "unique-skill");
    await install("unique-skill");
    // No select prompt should have been called (only 1 match)
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockCpSync).toHaveBeenCalled();
    existsSpy.mockRestore();
  });
});

// ── install — not-found with cli_tools in catalog (lines 139-140) ─────────────

describe("install — not-found suggestion with cli_tools in catalog", () => {
  it("includes cli_tools names in suggestion pool when searching for close matches", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [],
      rules: [],
      cli_tools: [
        {
          name: "ripgrep",
          description: "Fast search tool",
          category: "dev",
          recommended: false,
          commands: [],
        },
      ],
    });
    mockLoadState.mockReturnValue(makeState());
    // Make formatSuggestion return something to confirm the names were passed
    mockFormatSuggestion.mockReturnValue("Did you mean: ripgrep?");
    await install("ripgrp"); // typo — should find suggestion from cli_tools pool
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("Did you mean: ripgrep?");
    // Verify formatSuggestion was called with a pool including cli_tools name
    const [, pool] = mockFormatSuggestion.mock.calls[0] as [string, string[]];
    expect(pool).toContain("ripgrep");
  });

  it("includes source item names from findInAllSources with empty name in the suggestion pool", async () => {
    const source = makeSource({
      url: "a/repo",
      skillsInstalled: [],
      availableItems: [{ name: "", description: "Edge case: empty skill name in index", type: "skill" }],
    });
    mockLoadCatalog.mockReturnValue({ skills: [], mcp_servers: [], rules: [], cli_tools: [] });
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    mockFormatSuggestion.mockReturnValue("Did you mean: (empty name item)");
    await install("zzz-totally-nonexistent-name");
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("not found");
    expect(logs).toContain("agentbrew catalog");
    const [, pool] = mockFormatSuggestion.mock.calls[0] as [string, string[]];
    expect(pool).toContain("");
  });
});

// ── installRule — already-present standalone (line 347) ──────────────────────

describe("installRule — standalone already-present branch", () => {
  it("reports already present when rule is already in shared-rules.md", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [],
      rules: [
        {
          name: "conventional-commits",
          description: "Commit format rules",
          content: "<!-- rule: conventional-commits -->\nUse conventional commits.",
          category: "git",
          recommended: false,
        },
      ],
      cli_tools: [],
    });
    mockLoadState.mockReturnValue(makeState());
    const { loadSharedRules } = await import("../sync/rules-sync.js");
    vi.mocked(loadSharedRules).mockReturnValue(
      "# Rules\n<!-- rule: conventional-commits -->\nUse conventional commits.\n",
    );
    await install("conventional-commits");
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("already present");
    const { saveSharedRules } = await import("../sync/rules-sync.js");
    expect(vi.mocked(saveSharedRules)).not.toHaveBeenCalled();
  });

  // ── Regression: marker-based dedup (rules-dedup-fuzzy-match) ───────────────
  //
  // Real-world trigger: a user hand-wrote a rule that morally matches the
  // catalog version but with different wording. Before this PR the dedup
  // check was substring-based on the templated content, so the hand-written
  // version was missed and the catalog version appended as a dup. After this
  // PR, dedup is marker-based: if `<!-- rule: <name> -->` appears anywhere in
  // shared-rules.md, `agentbrew install <name>` is a no-op regardless of what
  // follows the marker. Users update content via `rules remove` + reinstall.

  it("treats different content with the same marker as already-present (no dup append)", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [],
      rules: [
        {
          name: "public-impersonation-ban",
          description: "Require per-session approval before posting under user identity",
          // The shipped catalog version.
          content: "Never post on the user's behalf without explicit per-session approval.",
          category: "collaboration",
          recommended: false,
        },
      ],
      cli_tools: [],
    });
    mockLoadState.mockReturnValue(makeState());
    const { loadSharedRules, saveSharedRules } = await import("../sync/rules-sync.js");
    // User hand-wrote a different wording but added the canonical marker
    // (or an earlier install wrote it — either way, the marker now exists
    // and the content differs from the current catalog body).
    vi.mocked(loadSharedRules).mockReturnValue(
      "# Rules\n\n<!-- rule: public-impersonation-ban -->\n" +
        "Don't impersonate the user via their Slack/GDoc without approval.\n",
    );

    await install("public-impersonation-ban");

    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("already present");
    // No duplicate marker or dup content appended.
    expect(vi.mocked(saveSharedRules)).not.toHaveBeenCalled();
  });

  it("appends the rule when the marker is absent, regardless of body similarity", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [],
      rules: [
        {
          name: "new-rule",
          description: "A rule",
          content: "Do the thing.",
          category: "collaboration",
          recommended: false,
        },
      ],
      cli_tools: [],
    });
    mockLoadState.mockReturnValue(makeState());
    const { loadSharedRules, saveSharedRules } = await import("../sync/rules-sync.js");
    // No marker. Even if the user happened to write "Do the thing." verbatim
    // by coincidence, the catalog install should append — markers are how we
    // track ownership, not text comparison.
    vi.mocked(loadSharedRules).mockReturnValue("# Rules\n\nDo the thing.\n");

    await install("new-rule");

    const written = vi.mocked(saveSharedRules).mock.calls[0]?.[0];
    expect(written).toBeDefined();
    expect(written).toContain("<!-- rule: new-rule -->");
  });
});

// ── flushInstallSummary ─────────────────────────────────────────────────────

describe("flushInstallSummary", () => {
  it("prints already-installed message for a single install call", async () => {
    const source = makeSource({
      url: "a/repo",
      skillsInstalled: ["skill-a"],
      availableItems: [{ name: "skill-a", description: "", type: "skill" }],
    });
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync").mockReturnValue(true);

    await install("skill-a", { from: "a/repo" });

    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("1 skill already installed (skipped)");
    existsSpy.mockRestore();
  });

  it("does not leak state between independent install() calls", async () => {
    const source = makeSource({
      url: "a/repo",
      skillsInstalled: ["skill-a", "skill-b"],
      availableItems: [
        { name: "skill-a", description: "", type: "skill" },
        { name: "skill-b", description: "", type: "skill" },
      ],
    });
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync").mockReturnValue(true);

    await install("skill-a", { from: "a/repo" });
    vi.mocked(console.log).mockClear();

    // Second install starts fresh — should NOT see skill-a's summary
    await install("skill-b", { from: "a/repo" });
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("1 skill already installed (skipped)");
    expect(logs).not.toContain("2 skills");
    existsSpy.mockRestore();
  });

  it("prints nothing when no items were batched", () => {
    vi.mocked(console.log).mockClear();
    flushInstallSummary();
    expect(console.log).not.toHaveBeenCalled();
  });

  it("clears the batch after flushing", async () => {
    const source = makeSource({
      url: "a/repo",
      skillsInstalled: ["skill-a"],
      availableItems: [{ name: "skill-a", description: "", type: "skill" }],
    });
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync").mockReturnValue(true);

    await install("skill-a", { from: "a/repo" });
    flushInstallSummary();
    vi.mocked(console.log).mockClear();

    // Second flush should print nothing
    flushInstallSummary();
    expect(console.log).not.toHaveBeenCalled();
    existsSpy.mockRestore();
  });
});

// ── Source-fallback dedup + honest messaging ────────────────────────────────
// Regression guard for `sync-source-install-dedup-and-messaging`. These tests
// lock down the behavior expected by real users: installing N skills from a
// single source repo produces ONE registration banner (naming the source URL,
// not a skill name), followed by one compact "also selected" line per extra
// skill — not N near-identical banners that conflate skills with sources.

describe("trySourceFallback — registration messaging", () => {
  it("uses the source URL (not the requested skill name) in the registration banner", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [
        {
          name: "semgrep",
          description: "Static analysis",
          source: "trailofbits/skills",
          category: "security",
          recommended: false,
        },
      ],
      mcp_servers: [],
      rules: [],
      cli_tools: [],
    });
    mockLoadState.mockReturnValue(makeState());
    mockGetSourceCachePath.mockReturnValue("/cache/trailofbits_skills");
    // Cache path exists but the specific skill path does not — triggers trySourceFallback
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync").mockReturnValue(false);
    mockScanDirectoryForSkills.mockReturnValue([
      { name: "semgrep", description: "", type: "skill" },
      { name: "codeql", description: "", type: "skill" },
      { name: "supply-chain-risk-auditor", description: "", type: "skill" },
    ]);

    await install("semgrep");

    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    // The banner should name the SOURCE URL and the available-skill count.
    expect(logs).toContain("Registered source trailofbits/skills");
    expect(logs).toContain("3 skills available");
    // The requested skill should appear as "selected".
    expect(logs).toContain("selected: semgrep");
    // The old misleading form "Source 'semgrep' registered (N skills)" must not survive.
    expect(logs).not.toContain("Source 'semgrep' registered");
    existsSpy.mockRestore();
  });

  it("emits a state-missing warning (not the success banner) when loadState returns undefined", async () => {
    // Regression guard for `try-source-fallback-banner-when-state-missing`:
    // a stale scan hit must not impersonate a successful registration when
    // agentbrew state is unavailable. The banner lies to the user; a warning
    // tells them what to do (run `agentbrew init`).
    //
    // `install()` calls requireState() first, then installSkill re-loads state
    // in isAlreadyInstalled + resolveSkillSource + trySourceFallback. Using
    // mockReturnValueOnce lets the early gates pass while trySourceFallback
    // sees undefined and takes the state-missing branch.
    mockLoadCatalog.mockReturnValue({
      skills: [
        {
          name: "semgrep",
          description: "Static analysis",
          source: "trailofbits/skills",
          category: "security",
          recommended: false,
        },
      ],
      mcp_servers: [],
      rules: [],
      cli_tools: [],
    });
    mockLoadState
      .mockReturnValueOnce(makeState()) // requireState in install()
      .mockReturnValueOnce(makeState()) // isAlreadyInstalled
      .mockReturnValueOnce(makeState()) // resolveSkillSource
      .mockReturnValue(undefined); // trySourceFallback (and any follow-up)
    mockGetSourceCachePath.mockReturnValue("/cache/trailofbits_skills");
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync").mockReturnValue(false);
    mockScanDirectoryForSkills.mockReturnValue([
      { name: "semgrep", description: "", type: "skill" },
      { name: "codeql", description: "", type: "skill" },
    ]);

    await install("semgrep");

    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");

    // Success banner MUST NOT print when nothing was actually registered.
    expect(logs).not.toContain("Registered source trailofbits/skills");
    // A clear warning + remediation action DOES print.
    expect(logs).toContain("trailofbits/skills contains 2 skill(s)");
    expect(logs).toContain("agentbrew state is unavailable");
    expect(logs).toContain("agentbrew init");
    // State write MUST NOT happen.
    expect(mockSaveState).not.toHaveBeenCalled();
    existsSpy.mockRestore();
  });

  it("prints the full banner once per source, then 'also selected' for follow-up skills", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [
        {
          name: "semgrep",
          description: "Static analysis",
          source: "trailofbits/skills",
          category: "security",
          recommended: false,
        },
        {
          name: "codeql",
          description: "Taint analysis",
          source: "trailofbits/skills",
          category: "security",
          recommended: false,
        },
      ],
      mcp_servers: [],
      rules: [],
      cli_tools: [],
    });
    mockLoadState.mockReturnValue(makeState());
    mockGetSourceCachePath.mockReturnValue("/cache/trailofbits_skills");
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync").mockReturnValue(false);
    mockScanDirectoryForSkills.mockReturnValue([
      { name: "semgrep", description: "", type: "skill" },
      { name: "codeql", description: "", type: "skill" },
    ]);

    await install("semgrep");
    await install("codeql");

    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join("\n");
    const bannerMatches = logs.match(/Registered source trailofbits\/skills/g) ?? [];
    // Banner fires exactly once per unique source URL in a session.
    expect(bannerMatches).toHaveLength(1);
    // Second skill shows up as an "also selected" line, not a second banner.
    expect(logs).toContain("also selected: codeql");
    existsSpy.mockRestore();
  });
});

describe("installFromSource — no 'Installing skill' banner when already installed", () => {
  it("skips the 'Installing skill' print for an already-installed skill", async () => {
    const source = makeSource({
      url: "a/repo",
      // Already in state AND on disk — should hit the alreadyInstalled batch path.
      skillsInstalled: ["debug"],
      availableItems: [{ name: "debug", description: "", type: "skill" }],
    });
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync").mockReturnValue(true);

    await install("debug", { from: "a/repo" });
    flushInstallSummary();

    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    // The noisy banner should NOT appear for skills that skip the actual work.
    expect(logs).not.toContain("Installing skill: debug from a/repo");
    // The summary line still fires so the user sees what happened.
    expect(logs).toContain("1 skill already installed (skipped)");
    expect(mockCpSync).not.toHaveBeenCalled();
    existsSpy.mockRestore();
  });
});

describe("installSkill — no 'Installing skill' banner when catalog skill is already installed globally", () => {
  it("skips the 'Installing skill' print for a catalog skill already installed globally", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [
        {
          name: "debug",
          description: "Debug skill",
          source: "a/repo",
          category: "dev",
          recommended: false,
        },
      ],
      mcp_servers: [],
      rules: [],
      cli_tools: [],
    });
    const source = makeSource({
      url: "a/repo",
      skillsInstalled: ["debug"],
      availableItems: [{ name: "debug", description: "", type: "skill" }],
    });
    mockLoadState.mockReturnValue(makeState({ sources: [source] }));
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync").mockReturnValue(true);

    await install("debug");
    flushInstallSummary();

    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).not.toContain("Installing skill: debug");
    expect(logs).toContain("1 skill already installed (skipped)");
    expect(mockCpSync).not.toHaveBeenCalled();
    existsSpy.mockRestore();
  });
});

// ── install with --local option ────────────────────────────────────────────

describe("install — local scope (--local flag)", () => {
  it("calls installSkillToProject when local dir is provided", async () => {
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    mockSkillCacheExists(existsSpy, "/cache/test", "agent-browser");

    mockLoadState.mockReturnValue(makeState());
    mockGetSourceCachePath.mockReturnValue("/cache/test");

    await install("agent-browser", { local: "/my/project" });

    expect(mockInstallSkillToProject).toHaveBeenCalledWith(
      "/my/project",
      "agent-browser",
      expect.stringContaining("agent-browser"),
    );
    // Should NOT update global state
    expect(mockSaveState).not.toHaveBeenCalled();
    existsSpy.mockRestore();
  });

  it("does not install locally for built-in skills", async () => {
    mockLoadState.mockReturnValue(makeState());
    await install("next-task", { local: "/my/project" });

    // Built-in skills short-circuit regardless of local flag
    expect(mockInstallSkillToProject).not.toHaveBeenCalled();
    expect(mockCpSync).not.toHaveBeenCalled();
  });

  it("installs globally when local option is not set", async () => {
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    mockSkillCacheExists(existsSpy, "/cache/test", "agent-browser");

    mockLoadState.mockReturnValue(makeState());
    mockGetSourceCachePath.mockReturnValue("/cache/test");

    await install("agent-browser");

    expect(mockInstallSkillToProject).not.toHaveBeenCalled();
    // Global install: cpSync and saveState should be called
    expect(mockCpSync).toHaveBeenCalled();
    existsSpy.mockRestore();
  });

  it("still installs locally even when skill is already installed globally", async () => {
    const existsSpy = vi.spyOn(await import("node:fs"), "existsSync");
    mockSkillCacheExists(existsSpy, "/cache/test", "agent-browser", (s) => {
      if (s.includes("installed-skills")) return true;
      return undefined;
    });

    mockLoadState.mockReturnValue(
      makeState({
        sources: [
          makeSource({
            url: "vercel-labs/agent-browser",
            skillsInstalled: ["agent-browser"],
          }),
        ],
      }),
    );
    mockGetSourceCachePath.mockReturnValue("/cache/test");

    await install("agent-browser", { local: "/my/project" });

    // Should install locally even though already installed globally
    expect(mockInstallSkillToProject).toHaveBeenCalled();
    existsSpy.mockRestore();
  });
});

// ── installRule — template substitution ─────────────────────────────────────

describe("installRule — {{ user_name }} template substitution", () => {
  // AGENTBREW_USER_NAME takes priority over git config + $USER, so this keeps the
  // test deterministic regardless of what machine it runs on.
  beforeEach(() => {
    vi.stubEnv("AGENTBREW_USER_NAME", "TestUser");
  });

  it("substitutes {{ user_name }} before writing content to shared-rules.md", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [],
      rules: [
        {
          name: "test-footer",
          description: "Test footer rule",
          content: "Written by an agent, not {{ user_name }}. Ping me if this looks off.",
          category: "collaboration",
          recommended: false,
        },
      ],
      cli_tools: [],
    });
    mockLoadState.mockReturnValue(makeState());
    const { loadSharedRules, saveSharedRules } = await import("../sync/rules-sync.js");
    vi.mocked(loadSharedRules).mockReturnValue("# Existing rules\n");

    await install("test-footer");

    const saved = vi.mocked(saveSharedRules).mock.calls[0]?.[0];
    expect(saved).toContain("Written by an agent, not TestUser. Ping me if this looks off.");
    expect(saved).not.toContain("{{ user_name }}");
  });

  it("detects already-present rules against the templated content, not the raw template", async () => {
    mockLoadCatalog.mockReturnValue({
      skills: [],
      mcp_servers: [],
      rules: [
        {
          name: "test-footer",
          description: "Test footer rule",
          content: "Not {{ user_name }}.",
          category: "collaboration",
          recommended: false,
        },
      ],
      cli_tools: [],
    });
    mockLoadState.mockReturnValue(makeState());
    const { loadSharedRules, saveSharedRules } = await import("../sync/rules-sync.js");
    // shared-rules.md already has the templated form (as it would after a previous install)
    vi.mocked(loadSharedRules).mockReturnValue("# Rules\n<!-- rule: test-footer -->\nNot TestUser.\n");

    await install("test-footer");

    expect(vi.mocked(saveSharedRules)).not.toHaveBeenCalled();
    const logs = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ]
      .flat()
      .join(" ");
    expect(logs).toContain("already present");
  });
});

// ── Catalog ships the agent-attribution-footer + public-impersonation-ban rules ───

describe("catalog — bundled authorship rules", () => {
  it("ships an agent-attribution-footer rule with a templated user_name", async () => {
    // Use the real catalog (restored in beforeEach) so the test proves the YAML was shipped.
    const { loadCatalog: realLoadCatalog } = await vi.importActual<typeof import("./types.js")>("./types.js");
    const catalog = realLoadCatalog();
    const rule = catalog.rules.find((r) => r.name === "agent-attribution-footer");
    expect(rule, "agent-attribution-footer rule should be in catalog.yaml").toBeDefined();
    expect(rule?.recommended).toBe(true);
    expect(rule?.content).toContain("{{ user_name }}");
  });

  it("agent-attribution-footer rule forbids tool-specific attribution and covers commits", async () => {
    // Regression guard — the rule's whole point is tool-neutral attribution. If anyone
    // ever re-adds a "Generated with [Devin]"-style carve-out or removes the commit-message
    // coverage, this test fails before the change ships.
    const { loadCatalog: realLoadCatalog } = await vi.importActual<typeof import("./types.js")>("./types.js");
    const catalog = realLoadCatalog();
    const rule = catalog.rules.find((r) => r.name === "agent-attribution-footer");
    expect(rule).toBeDefined();
    // Required-on list must explicitly include commit messages.
    expect(rule?.content).toMatch(/commit message/i);
    // Rule must explicitly forbid tool-specific attribution.
    expect(rule?.content).toMatch(/NO TOOL-SPECIFIC ATTRIBUTION/);
    // Specific examples of forbidden forms the rule calls out.
    expect(rule?.content).toContain("Generated with [Devin]");
    expect(rule?.content).toContain("Co-Authored-By: Devin");
    // Not-required-on list must NOT carve out commit messages.
    const notRequiredSection = rule?.content.split("Not required on:")[1]?.split("\n\n")[0] ?? "";
    expect(notRequiredSection).not.toMatch(/commit message bod/i);
  });

  it("ships a public-impersonation-ban rule", async () => {
    const { loadCatalog: realLoadCatalog } = await vi.importActual<typeof import("./types.js")>("./types.js");
    const catalog = realLoadCatalog();
    const rule = catalog.rules.find((r) => r.name === "public-impersonation-ban");
    expect(rule, "public-impersonation-ban rule should be in catalog.yaml").toBeDefined();
    expect(rule?.recommended).toBe(true);
    expect(rule?.content).toMatch(/approval|approve/i);
  });

  // ── public-write-approval-rule regression guard (TASKS.md task) ─────────────
  // These tests pin the removal of the old default-allow PR carve-out
  // carve-out and the addition of the stricter per-action approval policy.

  it("public-impersonation-ban rule does NOT carve out PR creation as allowed by default", async () => {
    const { loadCatalog: realLoadCatalog } = await vi.importActual<typeof import("./types.js")>("./types.js");
    const catalog = realLoadCatalog();
    const rule = catalog.rules.find((r) => r.name === "public-impersonation-ban");
    expect(rule).toBeDefined();
    expect(rule?.content).not.toMatch(new RegExp(`${["Opening", "pull requests"].join(" ")}[^.]*\\b${"OK"}\\b`));
    expect(rule?.content).not.toMatch(new RegExp(`${["gh", "pr", "create"].join(" ")}[^.]*\\b${"OK"}\\b`));
    expect(rule?.content).not.toMatch(new RegExp(`explicitly ${"OK"}`));
    // PR creation must appear somewhere near an approval requirement
    expect(rule?.content).toMatch(/pull request|gh pr create/i);
    expect(rule?.content).toMatch(/gh pr edit/i);
    expect(rule?.content).toMatch(/approval|approved/i);
  });

  it("public-impersonation-ban rule requires PR bodies to include a rationale", async () => {
    const { loadCatalog: realLoadCatalog } = await vi.importActual<typeof import("./types.js")>("./types.js");
    const catalog = realLoadCatalog();
    const rule = catalog.rules.find((r) => r.name === "public-impersonation-ban");
    expect(rule).toBeDefined();
    expect(rule?.content).toMatch(/why needed|rationale/i);
  });

  it("agent-attribution-footer rule does NOT reference PR creation as allowed by default", async () => {
    const { loadCatalog: realLoadCatalog } = await vi.importActual<typeof import("./types.js")>("./types.js");
    const catalog = realLoadCatalog();
    const rule = catalog.rules.find((r) => r.name === "agent-attribution-footer");
    expect(rule).toBeDefined();
    // The cross-reference to the old policy (line 1394-1396) must be gone
    expect(rule?.content).not.toMatch(
      new RegExp(["opening", "PRs", "is", "allowed", "by", "default"].join("\\s+"), "i"),
    );
    expect(rule?.content).not.toMatch(/even though\s+opening PRs/i);
    expect(rule?.content).not.toMatch(
      new RegExp(["allowed", "by", "default", "under", "the", "Public", "Impersonation", "Ban"].join("\\s+"), "i"),
    );
    // The footer must still be listed as required on PR descriptions
    expect(rule?.content).toMatch(/GitHub PR descriptions/i);
  });
});
