import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ctx = vi.hoisted(() => ({ homedir: "/tmp", shell: "zsh" }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => ctx.homedir };
});

import { generateCompletion, installCompletion, uninstallCompletion } from "./completions.js";

let testDir: string;

function buildTestProgram(): Command {
  const program = new Command();
  program.name("agentbrew").version("0.1.0");

  program.command("init").description("Detect agents and discover config");
  program.command("sync").description("Sync to all agents").option("--dry-run", "Preview changes");
  program.command("status").description("Show current status");

  const mcp = program.command("mcp").description("Manage MCP servers");
  mcp.command("list").description("Show registered servers");
  mcp.command("add").description("Add a server");
  mcp.command("remove").description("Remove a server");

  const enterprise = program.command("enterprise").description("Toggle enterprise mode");
  enterprise.command("on").description("Enable enterprise mode");
  enterprise.command("off").description("Disable enterprise mode");

  return program;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  testDir = join(tmpdir(), `completions-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  ctx.homedir = testDir;
  ctx.shell = "zsh";
});

describe("generateCompletion", () => {
  describe("bash", () => {
    it("generates valid bash completion script", () => {
      const program = buildTestProgram();
      const output = generateCompletion(program, "bash");

      expect(output).toContain("_agentbrew_completions");
      expect(output).toContain("complete -F _agentbrew_completions agentbrew");
      expect(output).toContain("init sync status mcp enterprise");
    });

    it("includes subcommand completions", () => {
      const program = buildTestProgram();
      const output = generateCompletion(program, "bash");

      expect(output).toContain("mcp)");
      expect(output).toContain("list add remove");
      expect(output).toContain("enterprise)");
      expect(output).toContain("on off");
    });
  });

  describe("zsh", () => {
    it("generates valid zsh completion script", () => {
      const program = buildTestProgram();
      const output = generateCompletion(program, "zsh");

      expect(output).toContain("#compdef agentbrew");
      expect(output).toContain("_agentbrew()");
      expect(output).toContain("'init:Detect agents and discover config'");
    });

    it("includes subcommand functions", () => {
      const program = buildTestProgram();
      const output = generateCompletion(program, "zsh");

      expect(output).toContain("_agentbrew_mcp()");
      expect(output).toContain("_agentbrew_enterprise()");
      expect(output).toContain("'list:Show registered servers'");
    });
  });

  describe("fish", () => {
    it("generates valid fish completion script", () => {
      const program = buildTestProgram();
      const output = generateCompletion(program, "fish");

      expect(output).toContain("complete -c agentbrew -f");
      expect(output).toContain("complete -c agentbrew -n '__fish_use_subcommand' -a 'init'");
      expect(output).toContain("-d 'Detect agents and discover config'");
    });

    it("includes subcommand completions", () => {
      const program = buildTestProgram();
      const output = generateCompletion(program, "fish");

      expect(output).toContain("__fish_seen_subcommand_from mcp");
      expect(output).toContain("-a 'list'");
      expect(output).toContain("-a 'add'");
    });

    it("includes option completions for commands", () => {
      const program = buildTestProgram();
      const output = generateCompletion(program, "fish");

      expect(output).toContain("dry-run");
    });
  });

  it("throws for unsupported shell", () => {
    const program = buildTestProgram();
    expect(() => generateCompletion(program, "powershell")).toThrow("Unsupported shell");
  });

  it("detects shell from SHELL env var", () => {
    const originalShell = process.env.SHELL;
    process.env.SHELL = "/bin/zsh";

    const program = buildTestProgram();
    const output = generateCompletion(program);

    expect(output).toContain("#compdef agentbrew");
    process.env.SHELL = originalShell;
  });

  it("defaults to bash when SHELL is unset", () => {
    const originalShell = process.env.SHELL;
    delete process.env.SHELL;

    const program = buildTestProgram();
    const output = generateCompletion(program);

    expect(output).toContain("complete -F _agentbrew_completions agentbrew");
    process.env.SHELL = originalShell;
  });
});

describe("installCompletion", () => {
  it("installs zsh completion file", () => {
    const program = buildTestProgram();
    mkdirSync(testDir, { recursive: true });
    const zshrc = join(testDir, ".zshrc");
    writeFileSync(zshrc, "# existing zshrc\n");

    installCompletion(program, "zsh");

    const completionFile = join(testDir, ".local", "share", "zsh", "site-functions", "_agentbrew");
    expect(existsSync(completionFile)).toBe(true);
    const content = readFileSync(completionFile, "utf-8");
    expect(content).toContain("#compdef agentbrew");
  });

  it("appends fpath to zshrc when not present", () => {
    const program = buildTestProgram();
    mkdirSync(testDir, { recursive: true });
    const zshrc = join(testDir, ".zshrc");
    writeFileSync(zshrc, "# existing zshrc\n");

    installCompletion(program, "zsh");

    const zshrcContent = readFileSync(zshrc, "utf-8");
    expect(zshrcContent).toContain("agentbrew completions");
    expect(zshrcContent).toContain("fpath=");
  });

  it("does not duplicate fpath in zshrc", () => {
    const program = buildTestProgram();
    mkdirSync(testDir, { recursive: true });
    const completionDir = join(testDir, ".local", "share", "zsh", "site-functions");
    const zshrc = join(testDir, ".zshrc");
    writeFileSync(zshrc, `# existing zshrc\nfpath=(${completionDir} $fpath)\n`);

    installCompletion(program, "zsh");

    const zshrcContent = readFileSync(zshrc, "utf-8");
    const fpathCount = (zshrcContent.match(/fpath=/g) ?? []).length;
    expect(fpathCount).toBe(1);
  });

  it("installs bash completion file", () => {
    const program = buildTestProgram();
    installCompletion(program, "bash");

    const completionFile = join(testDir, ".local", "share", "bash-completion", "completions", "agentbrew");
    expect(existsSync(completionFile)).toBe(true);
    const content = readFileSync(completionFile, "utf-8");
    expect(content).toContain("_agentbrew_completions");
  });

  it("installs fish completion file", () => {
    const program = buildTestProgram();
    installCompletion(program, "fish");

    const completionFile = join(testDir, ".config", "fish", "completions", "agentbrew.fish");
    expect(existsSync(completionFile)).toBe(true);
    const content = readFileSync(completionFile, "utf-8");
    expect(content).toContain("complete -c agentbrew");
  });

  it("installs zsh completion when .zshrc does not exist", () => {
    const program = buildTestProgram();
    mkdirSync(testDir, { recursive: true });
    // Do NOT create .zshrc — triggers the else branch (lines 225-228)

    installCompletion(program, "zsh");

    const completionFile = join(testDir, ".local", "share", "zsh", "site-functions", "_agentbrew");
    expect(existsSync(completionFile)).toBe(true);
    const content = readFileSync(completionFile, "utf-8");
    expect(content).toContain("#compdef agentbrew");
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Add to ~/.zshrc"));
  });

  it("sets exitCode=1 and prints error when file write fails", () => {
    process.exitCode = undefined;
    // Create testDir then use a file as homedir so mkdirSync fails
    mkdirSync(testDir, { recursive: true });
    const badPath = join(testDir, "not-a-dir");
    writeFileSync(badPath, "blocker");
    ctx.homedir = badPath;

    const program = buildTestProgram();
    installCompletion(program, "bash");

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Failed to install"));
    ctx.homedir = testDir;
    process.exitCode = undefined;
  });
});

describe("uninstallCompletion", () => {
  it("removes zsh completion file", () => {
    const completionDir = join(testDir, ".local", "share", "zsh", "site-functions");
    mkdirSync(completionDir, { recursive: true });
    const completionFile = join(completionDir, "_agentbrew");
    writeFileSync(completionFile, "# completion");

    uninstallCompletion("zsh");

    expect(existsSync(completionFile)).toBe(false);
  });

  it("removes bash completion file", () => {
    const completionDir = join(testDir, ".local", "share", "bash-completion", "completions");
    mkdirSync(completionDir, { recursive: true });
    const completionFile = join(completionDir, "agentbrew");
    writeFileSync(completionFile, "# completion");

    uninstallCompletion("bash");

    expect(existsSync(completionFile)).toBe(false);
  });

  it("removes fish completion file", () => {
    const completionDir = join(testDir, ".config", "fish", "completions");
    mkdirSync(completionDir, { recursive: true });
    const completionFile = join(completionDir, "agentbrew.fish");
    writeFileSync(completionFile, "# completion");

    uninstallCompletion("fish");

    expect(existsSync(completionFile)).toBe(false);
  });

  it("handles missing completion file gracefully", () => {
    expect(() => uninstallCompletion("zsh")).not.toThrow();
  });

  it("sets exitCode=1 when removing completion file fails", () => {
    process.exitCode = undefined;
    const completionDir = join(testDir, ".local", "share", "zsh", "site-functions");
    mkdirSync(completionDir, { recursive: true });
    const completionFile = join(completionDir, "_agentbrew");
    // Create a subdirectory with same name so unlinkSync fails
    mkdirSync(completionFile, { recursive: true });
    writeFileSync(join(completionFile, "child"), "block");

    uninstallCompletion("zsh");

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Failed to remove"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Check file permissions"));
    process.exitCode = undefined;
  });
});
