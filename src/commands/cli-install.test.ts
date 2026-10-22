import type { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../agentfile.js", () => ({
  addSourceToAgentfile: vi.fn(),
  addToAgentfile: vi.fn(),
  getConfigServers: vi.fn(() => []),
  getStateSources: vi.fn(() => []),
  globalAgentfileDir: vi.fn(() => "/fake/config/agentbrew"),
  installToProject: vi.fn(),
  applyAgentfile: vi.fn(),
}));

vi.mock("../catalog/install.js", () => ({
  install: vi.fn(),
}));

vi.mock("../core/cli-error.js", () => ({
  cliMissingArg: vi.fn(),
}));

vi.mock("../sync-runner.js", () => ({
  autoSync: vi.fn(),
}));

vi.mock("../sync/rules-sync.js", () => ({
  syncRules: vi.fn(),
}));

vi.mock("../add-source.js", () => ({
  addSource: vi.fn(),
}));

vi.mock("../sync/mcp-sync-commands.js", () => ({
  addMcpServer: vi.fn(),
}));

vi.mock("../mcp/mcp-git.js", () => ({
  installMcpFromGit: vi.fn(),
}));

vi.mock("../suggest.js", () => ({
  formatSuggestion: vi.fn(),
}));

vi.mock("../state.js", () => ({
  getStatePath: vi.fn(() => "/fake/config/agentbrew/state.yaml"),
  loadState: vi.fn(),
}));

vi.mock("../status.js", () => ({
  status: vi.fn(),
}));

vi.mock("../project-detect.js", () => ({
  detectProjectAssets: vi.fn(),
  formatProjectAssets: vi.fn(),
}));

vi.mock("../drift.js", () => ({
  collectDrift: vi.fn(() => []),
  formatDriftSummary: vi.fn((items: unknown[]) => (items.length > 0 ? `(${items.length} mcp)` : "")),
}));

vi.mock("../init.js", () => ({
  init: vi.fn(),
}));

// Real next-step planning and printing; the machine facts come from the mocks above, the rest is healthy.
vi.mock("../next-steps.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../next-steps.js")>();
  const agentfile = await import("../agentfile.js");
  return {
    ...original,
    collectDashboardFacts: vi.fn((state: never, repairableDrift: number) => ({
      hasSkillsOrServers: agentfile.getStateSources(state).length > 0 || agentfile.getConfigServers().length > 0,
      syncErrors: 0,
      repairableDrift,
      autoRepair: "active",
      autoSyncOptedOut: false,
      memoryServiceMissing: false,
      mcpNeedSetup: 0,
      mcpFailing: 0,
    })),
  };
});

import { addSource } from "../add-source.js";
import {
  addSourceToAgentfile,
  addToAgentfile,
  applyAgentfile,
  getConfigServers,
  getStateSources,
  globalAgentfileDir,
  installToProject,
} from "../agentfile.js";
import { install } from "../catalog/install.js";
import { cliMissingArg } from "../core/cli-error.js";
import { collectDrift } from "../drift.js";
import { init } from "../init.js";
import { installMcpFromGit } from "../mcp/mcp-git.js";
import { detectProjectAssets, formatProjectAssets } from "../project-detect.js";
import { getStatePath, loadState } from "../state.js";
import { status } from "../status.js";
import { formatSuggestion } from "../suggest.js";
import { addMcpServer } from "../sync/mcp-sync-commands.js";
import { syncRules } from "../sync/rules-sync.js";
import { autoSync } from "../sync-runner.js";
import { applyAgentfileAndInstall, registerDefaultAction, registerInstallCommand } from "./cli-install.js";
import { buildTestProgram } from "./test-program.js";

const mockAddToAgentfile = vi.mocked(addToAgentfile);
const mockAddSourceToAgentfile = vi.mocked(addSourceToAgentfile);
const mockApplyAgentfile = vi.mocked(applyAgentfile);
const mockGetConfigServers = vi.mocked(getConfigServers);
const mockGetStateSources = vi.mocked(getStateSources);
const _mockGlobalAgentfileDir = vi.mocked(globalAgentfileDir);
const mockInstallToProject = vi.mocked(installToProject);
const mockInstall = vi.mocked(install);
const mockCliMissingArg = vi.mocked(cliMissingArg);
const mockAutoSync = vi.mocked(autoSync);
const mockSyncRules = vi.mocked(syncRules);
const mockAddSource = vi.mocked(addSource);
const mockAddMcpServer = vi.mocked(addMcpServer);
const mockInstallMcpFromGit = vi.mocked(installMcpFromGit);
const mockFormatSuggestion = vi.mocked(formatSuggestion);
const mockGetStatePath = vi.mocked(getStatePath);
const mockLoadState = vi.mocked(loadState);
const mockStatus = vi.mocked(status);
const mockDetectProjectAssets = vi.mocked(detectProjectAssets);
const mockFormatProjectAssets = vi.mocked(formatProjectAssets);
const mockCollectDrift = vi.mocked(collectDrift);
const mockInit = vi.mocked(init);

let savedArgv: string[];

const buildInstallProgram = (): Command => buildTestProgram(registerInstallCommand);

const buildDefaultProgram = (): Command =>
  buildTestProgram((p) => {
    p.allowExcessArguments(true);
    registerDefaultAction(p);
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "cwd").mockReturnValue("/worktree");
  process.exitCode = undefined;
  savedArgv = process.argv;
});

afterEach(() => {
  process.argv = savedArgv;
});

describe("registerInstallCommand", () => {
  describe("catalog install (plain name)", () => {
    it("calls install with skill name and autoSync", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "debug"]);
      expect(mockInstall).toHaveBeenCalledWith(
        "debug",
        expect.objectContaining({ recommended: undefined, yes: undefined }),
      );
      expect(mockAutoSync).toHaveBeenCalledOnce();
    });

    it("passes --recommended flag", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "--recommended"]);
      expect(mockInstall).toHaveBeenCalledWith(undefined, expect.objectContaining({ recommended: true }));
    });

    it("passes --refresh-rules flag", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "--recommended", "--refresh-rules"]);
      expect(mockInstall).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({ recommended: true, refreshRules: true }),
      );
    });

    it("runs --refresh-rules alone as a rules-only refresh with no full sync", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "--refresh-rules"]);
      expect(mockInstall).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({ recommended: undefined, refreshRules: true }),
      );
      expect(mockAutoSync).not.toHaveBeenCalled();
      expect(mockSyncRules).toHaveBeenCalledOnce();
    });

    it("does not deploy rules for a rules-only --dry-run", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "--refresh-rules", "--dry-run"]);
      expect(mockAutoSync).not.toHaveBeenCalled();
      expect(mockSyncRules).not.toHaveBeenCalled();
    });

    it("passes --yes flag", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "my-skill", "-y"]);
      expect(mockInstall).toHaveBeenCalledWith("my-skill", expect.objectContaining({ yes: true }));
    });

    it("passes --from flag", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "my-skill", "--from", "my-source"]);
      expect(mockInstall).toHaveBeenCalledWith("my-skill", expect.objectContaining({ from: "my-source" }));
    });

    it("passes --dry-run flag and skips autoSync", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "my-skill", "--dry-run"]);
      expect(mockInstall).toHaveBeenCalledWith("my-skill", expect.objectContaining({ dryRun: true }));
      expect(mockAutoSync).not.toHaveBeenCalled();
    });

    it("forwards --recommended and --dry-run together and skips autoSync", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "--recommended", "--dry-run"]);
      expect(mockInstall).toHaveBeenCalledWith(undefined, expect.objectContaining({ recommended: true, dryRun: true }));
      expect(mockAutoSync).not.toHaveBeenCalled();
      expect(mockSyncRules).not.toHaveBeenCalled();
    });

    it("installs with no name (all recommended)", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install"]);
      expect(mockInstall).toHaveBeenCalledWith(undefined, expect.any(Object));
    });

    it("does NOT autoSync when install is called with no name and no --recommended (help-only display)", async () => {
      // `agentbrew install` (no args, no flags) shows Popular items — a help
      // display that mutates nothing. Running autoSync afterwards ran the full
      // deploy pipeline every time a user just wanted to browse. Skip it.
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install"]);
      expect(mockInstall).toHaveBeenCalledWith(undefined, expect.objectContaining({ recommended: undefined }));
      expect(mockAutoSync).not.toHaveBeenCalled();
    });

    it("DOES autoSync when install --recommended is called with no name", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "--recommended"]);
      expect(mockAutoSync).toHaveBeenCalledOnce();
    });

    it("skips autoSync when install sets process.exitCode (item not found)", async () => {
      // Regression: `agentbrew install fooskill` previously printed "'fooskill'
      // not found" AND then triggered a full autoSync, making it look like the
      // install succeeded and wasting ~1s of user time. `install()` signals
      // failure by setting process.exitCode; autoSync must honour that.
      mockInstall.mockImplementation(async () => {
        process.exitCode = 1;
      });
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "fooskill"]);

      expect(mockInstall).toHaveBeenCalledWith("fooskill", expect.any(Object));
      expect(mockAutoSync).not.toHaveBeenCalled();
    });

    it("skips autoSync when install --recommended sets process.exitCode (catalog corrupt)", async () => {
      mockInstall.mockImplementation(async () => {
        process.exitCode = 1;
      });
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "--recommended"]);

      expect(mockAutoSync).not.toHaveBeenCalled();
    });
  });

  describe("source installs", () => {
    it("records a local source in the global Agentfile before autoSync", async () => {
      const program = buildInstallProgram();

      await program.parseAsync(["node", "test", "install", "/tmp/my-skills"]);

      expect(mockAddSource).toHaveBeenCalledWith("/tmp/my-skills", { yes: undefined });
      expect(mockAddSourceToAgentfile).toHaveBeenCalledWith("/fake/config/agentbrew", "/tmp/my-skills");
      expect(mockAutoSync).toHaveBeenCalledOnce();
    });

    it("records a repo source in the global Agentfile before autoSync", async () => {
      const program = buildInstallProgram();

      await program.parseAsync(["node", "test", "install", "user/repo"]);

      expect(mockAddSource).toHaveBeenCalledWith("user/repo", { yes: undefined });
      expect(mockAddSourceToAgentfile).toHaveBeenCalledWith("/fake/config/agentbrew", "user/repo");
      expect(mockAutoSync).toHaveBeenCalledOnce();
    });
  });

  describe("npx scoped package shorthand", () => {
    it("auto-detects @scope/package and installs via npx", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "@modelcontextprotocol/server-github"]);
      expect(mockAddMcpServer).toHaveBeenCalledWith(
        "server-github",
        "npx",
        ["-y", "@modelcontextprotocol/server-github"],
        {},
      );
      expect(mockAddToAgentfile).toHaveBeenCalledWith(
        "/fake/config/agentbrew",
        expect.objectContaining({
          name: "server-github",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
        }),
        { create: true },
      );
      expect(mockAutoSync).toHaveBeenCalledOnce();
    });

    it("falls through to legacy when --command is also set", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "@my/pkg", "--command", "node"]);
      expect(mockAddMcpServer).toHaveBeenCalledWith(
        "@my/pkg",
        "node",
        [],
        {},
        expect.objectContaining({ url: undefined }),
      );
    });

    it("installs scoped package to project with --local", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "@my/mcp-server", "--local"]);
      expect(mockInstallToProject).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          name: "mcp-server",
          command: "npx",
          args: ["-y", "@my/mcp-server"],
        }),
      );
      expect(mockAddMcpServer).not.toHaveBeenCalled();
    });
  });

  describe("legacy flag install (--command, --url, --git)", () => {
    it("installs MCP server with --command", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "my-server", "--command", "npx"]);
      expect(mockAddMcpServer).toHaveBeenCalledWith(
        "my-server",
        "npx",
        [],
        {},
        expect.objectContaining({ url: undefined }),
      );
      expect(mockAutoSync).toHaveBeenCalledOnce();
    });

    it("passes --args with --command", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "srv", "--command", "npx", "--args", "arg1", "arg2"]);
      expect(mockAddMcpServer).toHaveBeenCalledWith("srv", "npx", ["arg1", "arg2"], {}, expect.any(Object));
    });

    it("keeps a -y inside --args for the MCP command (not the top-level --yes)", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "x", "--command", "npx", "--args", "-y", "pkg"]);
      expect(mockAddMcpServer).toHaveBeenCalledWith("x", "npx", ["-y", "pkg"], {}, expect.any(Object));
      expect(mockAddToAgentfile).toHaveBeenCalledWith(
        "/fake/config/agentbrew",
        expect.objectContaining({ args: ["-y", "pkg"] }),
        { create: true },
      );
    });

    it("keeps a -y in the middle of --args in its original position", async () => {
      const argv = [
        "node",
        "test",
        "install",
        "x",
        "--command",
        "npx",
        "--args",
        "--registry",
        "https://npm.example.com",
        "-y",
        "@scope/pkg",
        "--env",
        "A=1",
      ];
      process.argv = argv;
      const program = buildInstallProgram();
      await program.parseAsync(argv);
      expect(mockAddMcpServer).toHaveBeenCalledWith(
        "x",
        "npx",
        ["--registry", "https://npm.example.com", "-y", "@scope/pkg"],
        { A: "1" },
        expect.any(Object),
      );
    });

    it("shows the kept -y in the --dry-run preview", async () => {
      const argv = ["node", "test", "install", "x", "--command", "npx", "--args", "--quiet", "-y", "pkg", "--dry-run"];
      process.argv = argv;
      const program = buildInstallProgram();
      await program.parseAsync(argv);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("npx --quiet -y pkg"));
      expect(mockAddMcpServer).not.toHaveBeenCalled();
    });

    it("does not add -y to the MCP args when --yes comes before --args", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "x", "-y", "--command", "npx", "--args", "pkg"]);
      expect(mockAddMcpServer).toHaveBeenCalledWith("x", "npx", ["pkg"], {}, expect.any(Object));
    });

    it("parses --env KEY=VALUE pairs", async () => {
      const program = buildInstallProgram();
      await program.parseAsync([
        "node",
        "test",
        "install",
        "srv",
        "--command",
        "npx",
        "--env",
        "API_KEY=secret",
        "DEBUG=1",
      ]);
      expect(mockAddMcpServer).toHaveBeenCalledWith(
        "srv",
        "npx",
        [],
        { API_KEY: "secret", DEBUG: "1" },
        expect.any(Object),
      );
    });

    it("installs MCP server with --url", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "remote", "--url", "https://api.example.com/mcp"]);
      expect(mockAddMcpServer).toHaveBeenCalledWith(
        "remote",
        "",
        [],
        {},
        expect.objectContaining({ url: "https://api.example.com/mcp" }),
      );
    });

    it("installs from git with --git", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "my-server", "--git", "https://github.com/org/mcp"]);
      expect(mockInstallMcpFromGit).toHaveBeenCalledWith("https://github.com/org/mcp", {
        ref: undefined,
        name: "my-server",
      });
      expect(mockAddMcpServer).not.toHaveBeenCalled();
    });

    it("passes --ref with --git", async () => {
      const program = buildInstallProgram();
      await program.parseAsync([
        "node",
        "test",
        "install",
        "my-server",
        "--git",
        "https://github.com/org/mcp",
        "--ref",
        "v2.0",
      ]);
      expect(mockInstallMcpFromGit).toHaveBeenCalledWith("https://github.com/org/mcp", {
        ref: "v2.0",
        name: "my-server",
      });
    });

    it("calls cliMissingArg when name is missing without --git", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "--command", "npx"]);
      expect(mockCliMissingArg).toHaveBeenCalledWith("Server name", expect.any(String), expect.any(String));
      expect(mockAddMcpServer).not.toHaveBeenCalled();
    });

    it("prints dry-run preview with --dry-run and --command", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "srv", "--command", "npx", "--dry-run"]);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Dry run"));
      expect(mockAddMcpServer).not.toHaveBeenCalled();
    });

    it("prints dry-run preview with --dry-run and --git", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "srv", "--git", "https://github.com/org/mcp", "--dry-run"]);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Dry run"));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("git"));
      expect(mockInstallMcpFromGit).not.toHaveBeenCalled();
    });

    it("prints dry-run preview with --dry-run and --url", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "srv", "--url", "https://api.example.com/mcp", "--dry-run"]);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Dry run"));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("URL"));
      expect(mockAddMcpServer).not.toHaveBeenCalled();
    });

    it("adds to agentfile on legacy --command install", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "srv", "--command", "npx"]);
      expect(mockAddToAgentfile).toHaveBeenCalledWith(
        "/fake/config/agentbrew",
        expect.objectContaining({ name: "srv", command: "npx" }),
        { create: true },
      );
    });

    it("passes headers with --url install", async () => {
      const program = buildInstallProgram();
      await program.parseAsync([
        "node",
        "test",
        "install",
        "srv",
        "--url",
        "https://api.example.com/mcp",
        "--headers",
        "Authorization=Bearer tok123",
      ]);
      expect(mockAddMcpServer).toHaveBeenCalledWith(
        "srv",
        "",
        [],
        {},
        expect.objectContaining({
          url: "https://api.example.com/mcp",
          headers: { Authorization: "Bearer tok123" },
        }),
      );
    });
  });

  describe("source repo install (user/repo)", () => {
    it("calls addSource for GitHub shorthand", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "user/repo"]);
      expect(mockAddSource).toHaveBeenCalledWith("user/repo", { yes: undefined });
      expect(mockAutoSync).toHaveBeenCalledOnce();
    });

    it("passes --yes to addSource", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "user/repo", "-y"]);
      expect(mockAddSource).toHaveBeenCalledWith("user/repo", { yes: true });
    });

    it("prints dry-run preview for source repo", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "user/repo", "--dry-run"]);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Dry run"));
      expect(mockAddSource).not.toHaveBeenCalled();
    });
  });

  describe("local folder install", () => {
    it("calls addSource for relative path", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "./my-skills"]);
      expect(mockAddSource).toHaveBeenCalledWith("./my-skills", { yes: undefined });
      expect(mockAutoSync).toHaveBeenCalledOnce();
    });

    it("calls addSource for absolute path", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "/usr/local/skills"]);
      expect(mockAddSource).toHaveBeenCalledWith("/usr/local/skills", { yes: undefined });
    });

    it("calls addSource for home-relative path", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "~/my-skills"]);
      expect(mockAddSource).toHaveBeenCalledWith("~/my-skills", { yes: undefined });
    });

    it("prints dry-run preview for local folder", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "./my-skills", "--dry-run"]);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Dry run"));
      expect(mockAddSource).not.toHaveBeenCalled();
    });
  });

  describe("--local / --project scoped install", () => {
    it("passes local dir to catalog install with --local", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "debug", "--local"]);
      expect(mockInstall).toHaveBeenCalledWith("debug", expect.objectContaining({ local: expect.any(String) }));
    });

    it("passes local dir to catalog install with --project", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "debug", "--project"]);
      expect(mockInstall).toHaveBeenCalledWith("debug", expect.objectContaining({ local: expect.any(String) }));
    });

    it("skips autoSync for local catalog install", async () => {
      const program = buildInstallProgram();
      await program.parseAsync(["node", "test", "install", "debug", "--local"]);
      expect(mockAutoSync).not.toHaveBeenCalled();
    });
  });

  describe("-- (double-dash) install syntax", () => {
    it("installs MCP via -- syntax when process.argv contains --", async () => {
      process.argv = ["node", "test", "install", "my-server", "--", "npx", "@my/mcp-pkg"];
      const program = buildInstallProgram();
      await program.parseAsync(process.argv);
      expect(mockAddMcpServer).toHaveBeenCalledWith(
        "my-server",
        "npx",
        ["@my/mcp-pkg"],
        {},
        expect.objectContaining({ url: undefined }),
      );
      expect(mockAutoSync).toHaveBeenCalledOnce();
    });

    it("installs to project with -- and --local", async () => {
      process.argv = ["node", "test", "install", "my-server", "--local", "--", "npx", "@my/mcp-pkg"];
      const program = buildInstallProgram();
      await program.parseAsync(process.argv);
      expect(mockInstallToProject).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          name: "my-server",
          command: "npx",
          args: ["@my/mcp-pkg"],
        }),
      );
      expect(mockAddMcpServer).not.toHaveBeenCalled();
    });

    it("falls through when no -- in process.argv", async () => {
      process.argv = ["node", "test", "install", "debug"];
      const program = buildInstallProgram();
      await program.parseAsync(process.argv);
      expect(mockInstall).toHaveBeenCalledWith("debug", expect.any(Object));
    });
  });

  // ── Help text offline-mode pointer (agentbrew-install-offline-flag option B) ─
  //
  // Decision: ship the help-text update rather than a new --offline flag.
  // Per AGENTS rule #9 (keep public surface small), the existing config
  // (`skillInstallMode: native` in ~/.config/agentbrew/state.yaml) already
  // provides the offline opt-out. The only gap was discoverability — users
  // hitting corporate-proxy / offline errors had no in-CLI pointer to the
  // config. Adding the pointer to `--help` closes that gap without adding
  // a duplicate surface.
  //
  // Anchored to PR #1080 (which shipped the 4-failure-mode test matrix +
  // README "Fallback failure modes" table). Regression-catching: if the
  // help text drops the pointer, users back to "what do I do when this
  // breaks?" with no in-CLI breadcrumb.
  describe("install --help offline-mode pointer", () => {
    it("help text mentions skillInstallMode + README anchor", () => {
      const program = buildInstallProgram();
      const installCmd = program.commands.find((c) => c.name() === "install");
      expect(installCmd).toBeDefined();
      // Commander stores `addHelpText("after", ...)` separately from
      // `helpInformation()` — it's only emitted when outputHelp() runs.
      // Capture stdout so we see the full rendered help, including the
      // after-text.
      const writes: string[] = [];
      installCmd?.configureOutput({
        writeOut: (s) => {
          writes.push(s);
        },
      });
      installCmd?.outputHelp();
      const rendered = writes.join("");
      // The pointer must name the exact command that sets the key (no hand
      // edit of state.yaml) AND name the README section (so they can find
      // the 4-failure-mode table for triage).
      expect(rendered).toContain("agentbrew config set skillInstallMode native");
      expect(rendered).toContain("Delegated skill install networking");
    });
  });
});

describe("applyAgentfileAndInstall", () => {
  it("sets exitCode=1 when agentfile is not found", async () => {
    mockApplyAgentfile.mockReturnValue(undefined as unknown as ReturnType<typeof applyAgentfile>);
    await applyAgentfileAndInstall("/nonexistent/Agentfile.yaml");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(process.exitCode).toBe(1);
  });

  it("installs skills declared in agentfile", async () => {
    mockApplyAgentfile.mockReturnValue({
      skillsToInstall: ["debug", "review"],
      recommendedRequested: false,
    } as unknown as ReturnType<typeof applyAgentfile>);
    await applyAgentfileAndInstall("/path/to/Agentfile.yaml");
    expect(mockInstall).toHaveBeenCalledTimes(2);
    expect(mockInstall).toHaveBeenCalledWith("debug");
    expect(mockInstall).toHaveBeenCalledWith("review");
  });

  it("installs recommended set when requested", async () => {
    mockApplyAgentfile.mockReturnValue({
      skillsToInstall: [],
      recommendedRequested: true,
    } as unknown as ReturnType<typeof applyAgentfile>);
    await applyAgentfileAndInstall("/path/to/Agentfile.yaml");
    expect(mockInstall).toHaveBeenCalledWith(undefined, { recommended: true });
  });

  it("does nothing extra when no skills and no recommended", async () => {
    mockApplyAgentfile.mockReturnValue({
      skillsToInstall: [],
      recommendedRequested: false,
    } as unknown as ReturnType<typeof applyAgentfile>);
    await applyAgentfileAndInstall("/path/to/Agentfile.yaml");
    expect(mockInstall).not.toHaveBeenCalled();
  });

  it("skips requested item installs when disabled", async () => {
    mockApplyAgentfile.mockReturnValue({
      skillsToInstall: ["debug"],
      recommendedRequested: true,
    } as unknown as ReturnType<typeof applyAgentfile>);
    await applyAgentfileAndInstall("/path/to/Agentfile.yaml", { installRequestedItems: false });
    expect(mockInstall).not.toHaveBeenCalled();
    expect(mockApplyAgentfile).toHaveBeenCalledWith(
      expect.stringContaining("Agentfile.yaml"),
      expect.objectContaining({ includeSkillInstallReport: false }),
    );
  });

  it("dry-runs explicit Agentfiles without installing requested items", async () => {
    mockApplyAgentfile.mockReturnValue({
      skillsToInstall: ["debug"],
      recommendedRequested: true,
    } as unknown as ReturnType<typeof applyAgentfile>);

    await applyAgentfileAndInstall("/path/to/Agentfile.yaml", { dryRun: true });

    expect(mockApplyAgentfile).toHaveBeenCalledWith(
      expect.stringContaining("Agentfile.yaml"),
      expect.objectContaining({ authoritative: true, dryRun: true }),
    );
    expect(mockInstall).not.toHaveBeenCalled();
  });

  it("applies non-authoritatively when asked (sync --no-prune)", async () => {
    mockApplyAgentfile.mockReturnValue({
      skillsToInstall: [],
      recommendedRequested: false,
    } as unknown as ReturnType<typeof applyAgentfile>);
    await applyAgentfileAndInstall("/path/to/Agentfile.yaml", { authoritative: false });
    expect(mockApplyAgentfile).toHaveBeenCalledWith(
      expect.stringContaining("Agentfile.yaml"),
      expect.objectContaining({ authoritative: false }),
    );
  });
});

describe("registerDefaultAction", () => {
  it("shows suggestion for unknown command", async () => {
    mockFormatSuggestion.mockReturnValue('Did you mean "install"?');
    const program = buildDefaultProgram();
    program.command("install").action(() => {});
    await program.parseAsync(["node", "test", "instal"]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Unknown command"));
    expect(process.exitCode).toBe(1);
  });

  it("shows dashboard when state exists", async () => {
    mockLoadState.mockReturnValue({ mcpServers: {}, agents: [{ name: "claude-code" }] } as unknown as ReturnType<
      typeof loadState
    >);
    mockDetectProjectAssets.mockReturnValue(undefined as unknown as ReturnType<typeof detectProjectAssets>);
    mockCollectDrift.mockReturnValue([]);
    mockGetStateSources.mockReturnValue([]);
    mockGetConfigServers.mockReturnValue([]);
    const program = buildDefaultProgram();
    await program.parseAsync(["node", "test"]);
    expect(mockStatus).toHaveBeenCalledOnce();
  });

  it("calls init when state is missing and TTY", async () => {
    mockLoadState.mockReturnValue(undefined as unknown as ReturnType<typeof loadState>);
    const origIsTTY = process.stdout.isTTY;
    process.stdout.isTTY = true as unknown as typeof process.stdout.isTTY;
    const origEnv = process.env.AGENTBREW_NO_AUTO_INIT;
    delete process.env.AGENTBREW_NO_AUTO_INIT;
    try {
      const program = buildDefaultProgram();
      await program.parseAsync(["node", "test"]);
      expect(mockInit).toHaveBeenCalledOnce();
    } finally {
      process.stdout.isTTY = origIsTTY;
      if (origEnv !== undefined) process.env.AGENTBREW_NO_AUTO_INIT = origEnv;
    }
  });

  it("shows help when state is missing and non-TTY", async () => {
    mockLoadState.mockReturnValue(undefined as unknown as ReturnType<typeof loadState>);
    const origIsTTY = process.stdout.isTTY;
    process.stdout.isTTY = undefined as unknown as typeof process.stdout.isTTY;
    try {
      const program = buildDefaultProgram();
      await program.parseAsync(["node", "test"]);
      expect(mockInit).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("not initialized"));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("agentbrew init"));
      expect(mockStatus).not.toHaveBeenCalled();
    } finally {
      process.stdout.isTTY = origIsTTY;
    }
  });

  it("treats a state.yaml with no agents (config set before init) as not set up", async () => {
    mockLoadState.mockReturnValue({ agents: [], claudePermissions: "keep" } as unknown as ReturnType<typeof loadState>);
    const origIsTTY = process.stdout.isTTY;
    process.stdout.isTTY = undefined as unknown as typeof process.stdout.isTTY;
    try {
      const program = buildDefaultProgram();
      await program.parseAsync(["node", "test"]);
      expect(mockStatus).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("agentbrew init"));
    } finally {
      process.stdout.isTTY = origIsTTY;
    }
  });

  it("clears a stale exit code when state is missing and auto-init is disabled", async () => {
    mockLoadState.mockReturnValue(undefined as unknown as ReturnType<typeof loadState>);
    mockGetStatePath.mockReturnValue("/definitely/missing/state.yaml");
    process.exitCode = 1;
    const origEnv = process.env.AGENTBREW_NO_AUTO_INIT;
    process.env.AGENTBREW_NO_AUTO_INIT = "1";
    try {
      const program = buildDefaultProgram();
      await program.parseAsync(["node", "test"]);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("not initialized"));
      expect(process.exitCode).toBe(0);
    } finally {
      if (origEnv === undefined) {
        delete process.env.AGENTBREW_NO_AUTO_INIT;
      } else {
        process.env.AGENTBREW_NO_AUTO_INIT = origEnv;
      }
    }
  });

  it("keeps a failing exit code when the state file exists but could not be loaded", async () => {
    mockLoadState.mockReturnValue(undefined as unknown as ReturnType<typeof loadState>);
    // Any path that exists on every machine: this test file.
    mockGetStatePath.mockReturnValue(import.meta.filename);
    process.exitCode = 1;
    const origEnv = process.env.AGENTBREW_NO_AUTO_INIT;
    process.env.AGENTBREW_NO_AUTO_INIT = "1";
    try {
      const program = buildDefaultProgram();
      await program.parseAsync(["node", "test"]);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("not initialized"));
      expect(process.exitCode).toBe(1);
    } finally {
      if (origEnv === undefined) {
        delete process.env.AGENTBREW_NO_AUTO_INIT;
      } else {
        process.env.AGENTBREW_NO_AUTO_INIT = origEnv;
      }
    }
  });

  it("shows drift count when drift exists", async () => {
    mockLoadState.mockReturnValue({ mcpServers: {}, agents: [{ name: "claude-code" }] } as unknown as ReturnType<
      typeof loadState
    >);
    mockDetectProjectAssets.mockReturnValue(undefined as unknown as ReturnType<typeof detectProjectAssets>);
    mockCollectDrift.mockReturnValue([
      { agent: "cursor", type: "mcp", detail: "missing server: foo" },
    ] as unknown as ReturnType<typeof collectDrift>);
    mockGetStateSources.mockReturnValue([]);
    mockGetConfigServers.mockReturnValue([]);
    const program = buildDefaultProgram();
    await program.parseAsync(["node", "test"]);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Drift"));
    // The repairable drift becomes the next step, with the exact command.
    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(calls).toMatch(/agentbrew sync[\s\S]*Repair 1 drift issue/);
  });

  it("dashboard does NOT count user-added items (skills/mcp/commands) as drift", async () => {
    // Regression: the "Drift: 82 issue(s)" message lumped together actual
    // repairable drift with "user-added" items (skills the user authored,
    // MCP servers in agent configs agentbrew never installed, etc.). That
    // number alarmed users into running `agentbrew sync` to "repair" things
    // that were their own customizations. The dashboard must filter those
    // out and show a breakdown.
    mockLoadState.mockReturnValue({ mcpServers: {}, agents: [{ name: "claude-code" }] } as unknown as ReturnType<
      typeof loadState
    >);
    mockDetectProjectAssets.mockReturnValue(undefined as unknown as ReturnType<typeof detectProjectAssets>);
    mockCollectDrift.mockReturnValue([
      { agent: "cursor", type: "mcp", detail: "missing server: foo" },
      { agent: "cursor", type: "skills-user-added", detail: "user-created skill: my-skill" },
      { agent: "cursor", type: "skills-user-added", detail: "user-created skill: another" },
      { agent: "claude-code", type: "mcp-user-added", detail: "untracked server: my-tool" },
      { agent: "claude-code", type: "commands-user-added", detail: "user-created command: cmd.md" },
    ] as unknown as ReturnType<typeof collectDrift>);
    mockGetStateSources.mockReturnValue([]);
    mockGetConfigServers.mockReturnValue([]);
    const program = buildDefaultProgram();
    await program.parseAsync(["node", "test"]);

    const calls = (console.log as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    // Only 1 actual drift item; 4 user-added items. The "Drift: N" line
    // must count only the 1 repairable item, not 5.
    expect(calls).toMatch(/Drift: 1 issue/);
    // And there should be a separate, non-alarming summary for user-added.
    expect(calls).toMatch(/4.*user-added|user-added.*4/);
  });

  it("shows next action hint when no skills and no servers", async () => {
    mockLoadState.mockReturnValue({ mcpServers: {}, agents: [{ name: "claude-code" }] } as unknown as ReturnType<
      typeof loadState
    >);
    mockDetectProjectAssets.mockReturnValue(undefined as unknown as ReturnType<typeof detectProjectAssets>);
    mockCollectDrift.mockReturnValue([]);
    mockGetStateSources.mockReturnValue([]);
    mockGetConfigServers.mockReturnValue([]);
    const program = buildDefaultProgram();
    await program.parseAsync(["node", "test"]);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("install --recommended"));
  });

  it("shows quick actions when skills or servers exist", async () => {
    mockLoadState.mockReturnValue({ mcpServers: {}, agents: [{ name: "claude-code" }] } as unknown as ReturnType<
      typeof loadState
    >);
    mockDetectProjectAssets.mockReturnValue(undefined as unknown as ReturnType<typeof detectProjectAssets>);
    mockCollectDrift.mockReturnValue([]);
    mockGetStateSources.mockReturnValue([{ label: "x", path: "/x" }] as unknown as ReturnType<typeof getStateSources>);
    mockGetConfigServers.mockReturnValue([]);
    const program = buildDefaultProgram();
    await program.parseAsync(["node", "test"]);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Quick actions"));
  });

  it("shows project assets when detected", async () => {
    mockLoadState.mockReturnValue({ mcpServers: {}, agents: [{ name: "claude-code" }] } as unknown as ReturnType<
      typeof loadState
    >);
    mockDetectProjectAssets.mockReturnValue({ skills: 2 } as unknown as ReturnType<typeof detectProjectAssets>);
    mockFormatProjectAssets.mockReturnValue("  Project: 2 skills");
    mockCollectDrift.mockReturnValue([]);
    mockGetStateSources.mockReturnValue([]);
    mockGetConfigServers.mockReturnValue([]);
    const program = buildDefaultProgram();
    await program.parseAsync(["node", "test"]);
    expect(mockFormatProjectAssets).toHaveBeenCalled();
  });
});
