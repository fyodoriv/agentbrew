import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
/**
 * Integration tests for infrastructure commands — completions, shell hooks,
 * and auto-sync. These live in a separate file from integration.test.ts
 * because that file mocks shell-hook.js and auto-sync.js wholesale to
 * prevent side effects during state-management tests. Here we test the
 * real implementations against a sandboxed home directory.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks that must be hoisted ──────────────────────────────────────────────

const ctx = vi.hoisted(() => ({
  home: `/tmp/agentbrew-us21-${Date.now()}-${Math.random().toString(36).slice(2)}`,
}));
const TEST_HOME = ctx.home;

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => ctx.home, tmpdir: actual.tmpdir };
});

// Mock child_process to prevent launchctl/osascript/which calls while
// allowing write-file-atomic and other real filesystem operations.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: vi.fn((...args: unknown[]) => {
      const cmd = args[0] as string;
      if (cmd === "claude") {
        return {
          status: 0,
          stdout: Buffer.from(""),
          stderr: Buffer.from(""),
          error: null,
          pid: 0,
          signal: null,
          output: [],
        };
      }
      return actual.spawnSync(cmd, ...(args.slice(1) as [object]));
    }),
    execFileSync: vi.fn((...args: unknown[]) => {
      const cmd = args[0] as string;
      // Block system commands that would modify the real machine
      if (["launchctl", "osascript", "which", "systemctl", "schtasks", "crontab", "npx"].includes(cmd)) {
        return "";
      }
      return actual.execFileSync(cmd, ...(args.slice(1) as [object]));
    }),
  };
});

// Prevent network calls for source fetching
vi.mock("./fetch-sources.js", () => ({
  fetchSources: vi.fn(async () => []),
  isCacheFresh: vi.fn(() => true),
}));

// Prevent catalog from hitting network
vi.mock("./catalog/index-source.js", () => ({
  indexSource: vi.fn(() => []),
  indexAllSources: vi.fn(async () => {}),
  getSourceCachePath: vi.fn(() => undefined),
  isSourceFailed: vi.fn(() => false),
  classifyGitError: vi.fn(() => ""),
  formatItemCounts: vi.fn(() => ""),
  resetSessionCache: vi.fn(),
}));

// Prevent env hygiene check
vi.mock("./core/env-sanitize.js", () => ({
  checkEnvHygiene: vi.fn(() => []),
}));

// ── Real imports (after mocks) ──────────────────────────────────────────────

import { Command } from "commander";
import { installCompletion, uninstallCompletion } from "./completions.js";
import { installShellHook, isShellHookInstalled, uninstallShellHook } from "./shell-hook.js";
import { installAutoSync, isAutoSyncInstalled, uninstallAutoSync } from "./sync/auto-sync.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Create a minimal Commander program for testing completions. */
function createTestProgram(): Command {
  const program = new Command("agentbrew");
  program.command("sync").description("Sync all agents");
  program.command("status").description("Show status");
  const mcp = program.command("mcp").description("Manage MCP servers");
  mcp.command("add").description("Add an MCP server");
  mcp.command("remove").description("Remove an MCP server");
  return program;
}

// ── Setup / teardown ────────────────────────────────────────────────────────

const originalHome = process.env.HOME;

beforeEach(() => {
  process.env.HOME = TEST_HOME;
  process.exitCode = undefined;
  mkdirSync(join(TEST_HOME, ".config", "agentbrew"), { recursive: true });
});

afterAll(() => {
  process.env.HOME = originalHome;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

// ── Section 25: completions + shell hooks + auto-sync (US21) ────────────────

describe("completions + shell hooks + auto-sync (US21)", () => {
  it("installCompletion for bash creates file at correct path → uninstallCompletion removes it", () => {
    const program = createTestProgram();
    installCompletion(program, "bash");

    const completionFile = join(TEST_HOME, ".local", "share", "bash-completion", "completions", "agentbrew");
    expect(existsSync(completionFile)).toBe(true);

    const content = readFileSync(completionFile, "utf-8");
    expect(content).toContain("_agentbrew_completions");
    expect(content).toContain("sync");
    expect(content).toContain("status");
    expect(content).toContain("mcp");
    expect(content).toContain("complete -F _agentbrew_completions agentbrew");

    uninstallCompletion("bash");
    expect(existsSync(completionFile)).toBe(false);
  });

  it("installCompletion for zsh creates completion file and appends fpath to .zshrc", () => {
    const program = createTestProgram();
    const zshrcPath = join(TEST_HOME, ".zshrc");
    writeFileSync(zshrcPath, "# test zshrc\n");

    installCompletion(program, "zsh");

    const completionFile = join(TEST_HOME, ".local", "share", "zsh", "site-functions", "_agentbrew");
    expect(existsSync(completionFile)).toBe(true);

    const content = readFileSync(completionFile, "utf-8");
    expect(content).toContain("#compdef agentbrew");
    expect(content).toContain("_agentbrew");

    const zshrc = readFileSync(zshrcPath, "utf-8");
    expect(zshrc).toContain("agentbrew completions");
    expect(zshrc).toContain("fpath=");
    expect(zshrc).toContain("compinit");

    // Second install should NOT duplicate the fpath line (idempotent)
    installCompletion(program, "zsh");
    const zshrc2 = readFileSync(zshrcPath, "utf-8");
    const fpathCount = zshrc2.split("fpath=").length - 1;
    expect(fpathCount).toBe(1);
  });

  it("installShellHook creates hook script + appends to .zshrc → isShellHookInstalled returns true", () => {
    const zshrcPath = join(TEST_HOME, ".zshrc");
    writeFileSync(zshrcPath, "# test zshrc\n");

    installShellHook();

    // Hook script exists
    expect(isShellHookInstalled()).toBe(true);
    const hookPath = join(TEST_HOME, ".config", "agentbrew", "shell-hook.sh");
    expect(existsSync(hookPath)).toBe(true);

    const hookContent = readFileSync(hookPath, "utf-8");
    expect(hookContent).toContain("_agentbrew_detect");
    expect(hookContent).toContain("chpwd");
    expect(hookContent).toContain("Agentfile");

    // .zshrc has source line
    const zshrc = readFileSync(zshrcPath, "utf-8");
    expect(zshrc).toContain("# agentbrew shell hook");
    expect(zshrc).toContain("shell-hook.sh");

    // Idempotent — second install doesn't duplicate .zshrc entries
    installShellHook();
    const zshrc2 = readFileSync(zshrcPath, "utf-8");
    const guardCount = zshrc2.split("# agentbrew shell hook").length - 1;
    expect(guardCount).toBe(1);
  });

  it("uninstallShellHook removes hook script + cleans .zshrc → isShellHookInstalled returns false", () => {
    const zshrcPath = join(TEST_HOME, ".zshrc");
    writeFileSync(zshrcPath, "# test zshrc\nexport FOO=1\n");

    installShellHook();
    expect(isShellHookInstalled()).toBe(true);

    uninstallShellHook();

    // Hook script removed
    expect(isShellHookInstalled()).toBe(false);
    const hookPath = join(TEST_HOME, ".config", "agentbrew", "shell-hook.sh");
    expect(existsSync(hookPath)).toBe(false);

    // .zshrc cleaned — hook lines removed but other content preserved
    const zshrc = readFileSync(zshrcPath, "utf-8");
    expect(zshrc).not.toContain("# agentbrew shell hook");
    expect(zshrc).not.toContain("shell-hook.sh");
    expect(zshrc).toContain("export FOO=1");
  });

  it("installAutoSync creates LaunchAgent plist → isAutoSyncInstalled returns true → uninstallAutoSync removes it", async () => {
    // Create Library/LaunchAgents dir (normally exists on macOS)
    mkdirSync(join(TEST_HOME, "Library", "LaunchAgents"), { recursive: true });

    await installAutoSync();

    const plistPath = join(TEST_HOME, "Library", "LaunchAgents", "com.agentbrew.check.plist");
    expect(existsSync(plistPath)).toBe(true);

    const content = readFileSync(plistPath, "utf-8");
    expect(content).toContain("com.agentbrew.check");
    expect(content).toContain("agentbrew");
    expect(content).toContain("StartInterval");

    expect(isAutoSyncInstalled()).toBe(true);

    await uninstallAutoSync();
    expect(existsSync(plistPath)).toBe(false);
    expect(isAutoSyncInstalled()).toBe(false);
  });
});
