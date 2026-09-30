import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { buildProgram, HELP_COMMAND_GROUPS, isCliEntrypoint } from "./cli.js";

const run = promisify(execFile);
const CLI_TEST_TIMEOUT_MS = 20_000;

/** Run the CLI with given args, capturing stdout/stderr. */
async function cli(...args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AGENTBREW_NO_AUTO_INIT: "1",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
  };
  delete env.BASH_ENV;
  delete env.ENV;
  try {
    const { stdout, stderr } = await run(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
      cwd: join(import.meta.dirname, ".."),
      timeout: CLI_TEST_TIMEOUT_MS,
      env,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: e.code ?? 1 };
  }
}

/** Memoized CLI runner — tests sharing the same args reuse one spawn. */
const cliCache = new Map<string, Promise<{ stdout: string; stderr: string; exitCode: number }>>();
function cachedCli(...args: string[]) {
  const key = JSON.stringify(args);
  if (!cliCache.has(key)) cliCache.set(key, cli(...args));
  return cliCache.get(key)!;
}

const { version } = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf-8")) as {
  version: string;
};

describe("cli entry point", () => {
  // Pre-warm all cached CLI spawns so individual tests don't timeout
  // waiting for cold tsx/node compilation on the first invocations.
  beforeAll(async () => {
    await Promise.all([
      cachedCli("--version"),
      cachedCli("-V"),
      cachedCli("--help"),
      cachedCli("sync", "--help"),
      cachedCli("install", "--help"),
    ]);
  }, 30_000);

  // ── Version ────────────────────────────────────────────────────────────

  it("--version prints the package version", { timeout: CLI_TEST_TIMEOUT_MS }, async () => {
    const { stdout, exitCode } = await cachedCli("--version");
    expect(stdout.trim()).toBe(version);
    expect(exitCode).toBe(0);
  });

  it("-V is an alias for --version", { timeout: CLI_TEST_TIMEOUT_MS }, async () => {
    const { stdout, exitCode } = await cachedCli("-V");
    expect(stdout.trim()).toBe(version);
    expect(exitCode).toBe(0);
  });

  it("recognizes an npm-style executable symlink as the CLI entrypoint", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "agentbrew-cli-entrypoint-"));
    const sourcePath = join(import.meta.dirname, "cli.ts");
    const executablePath = join(temporaryDirectory, "agentbrew");
    try {
      symlinkSync(sourcePath, executablePath);
      expect(isCliEntrypoint(new URL("./cli.ts", import.meta.url).href, executablePath)).toBe(true);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  // ── Help text ──────────────────────────────────────────────────────────

  it("--help shows usage with grouped command sections", { timeout: CLI_TEST_TIMEOUT_MS }, async () => {
    const { stdout, exitCode } = await cachedCli("--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage: agentbrew");
    expect(stdout).toContain("Core:");
    // Groups consolidated for "one command, sensible defaults" UX: Install →
    // Catalog (clearer name), Config folded into Advanced (import/export are
    // narrower workflows), Ops still here for `upgrade`. All previously-visible
    // commands remain registered and discoverable under "Advanced:".
    expect(stdout).toContain("Catalog:");
    expect(stdout).toContain("Ops:");
    expect(stdout).toContain("Advanced:");
  });

  it("--help lists all core commands", { timeout: CLI_TEST_TIMEOUT_MS }, async () => {
    const { stdout } = await cachedCli("--help");
    expect(stdout).toContain("init");
    expect(stdout).toContain("status");
    expect(stdout).toContain("sync");
    expect(stdout).toContain("catalog");
    expect(stdout).toContain("install");
    expect(stdout).toContain("remove");
    expect(stdout).toContain("env");
  });

  it("--help includes examples section", { timeout: CLI_TEST_TIMEOUT_MS }, async () => {
    const { stdout } = await cachedCli("--help");
    expect(stdout).toContain("Examples:");
    expect(stdout).toContain("agentbrew install");
  });

  // ── Subcommand help ────────────────────────────────────────────────────

  it("sync --help lists all sync options", { timeout: CLI_TEST_TIMEOUT_MS }, async () => {
    const { stdout, exitCode } = await cachedCli("sync", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--dry-run");
    expect(stdout).toContain("--pull");
    expect(stdout).toContain("--rollback");
    expect(stdout).toContain("--only");
    expect(stdout).toContain("--discover");
    expect(stdout).toContain("--verbose");
    expect(stdout).toContain("--agentfile");
    expect(stdout).toContain("--sequential");
    // New: sync auto-installs recommended catalog items; --no-recommended opts out.
    expect(stdout).toContain("--no-recommended");
  });

  it("install --help lists all install options", { timeout: CLI_TEST_TIMEOUT_MS }, async () => {
    const { stdout, exitCode } = await cachedCli("install", "--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--recommended");
    expect(stdout).toContain("--local");
    expect(stdout).toContain("--global");
    expect(stdout).toContain("--url");
    expect(stdout).toContain("--git");
    expect(stdout).toContain("--dry-run");
    expect(stdout).toContain("--command");
    expect(stdout).toContain("--env");
    expect(stdout).toContain("--headers");
  });

  it("install --help includes examples", { timeout: CLI_TEST_TIMEOUT_MS }, async () => {
    const { stdout } = await cachedCli("install", "--help");
    expect(stdout).toContain("Examples:");
    expect(stdout).toContain("agentbrew install debug");
    expect(stdout).toContain("--recommended");
  });

  it("sync --help includes examples", { timeout: CLI_TEST_TIMEOUT_MS }, async () => {
    const { stdout } = await cachedCli("sync", "--help");
    expect(stdout).toContain("Examples:");
    expect(stdout).toContain("agentbrew sync --dry-run");
  });

  // ── Unknown command handling ───────────────────────────────────────────

  it("unknown command prints error and suggests alternatives", { timeout: CLI_TEST_TIMEOUT_MS }, async () => {
    const { stdout, stderr, exitCode } = await cli("badcommand");
    const output = stdout + stderr;
    expect(exitCode).toBe(1);
    expect(output).toContain("Unknown command: badcommand");
    expect(output).toContain("agentbrew --help");
  });

  it("unknown command similar to real command shows suggestion", { timeout: CLI_TEST_TIMEOUT_MS }, async () => {
    const { stdout, stderr } = await cli("symc");
    const output = stdout + stderr;
    expect(output).toContain("Did you mean");
  });

  // ── Error handling ─────────────────────────────────────────────────────

  it("missing required arg for install --command shows error", { timeout: CLI_TEST_TIMEOUT_MS }, async () => {
    const { stdout, stderr, exitCode } = await cli("install", "--command", "npx");
    const output = stdout + stderr;
    expect(exitCode).not.toBe(0);
    expect(output.length).toBeGreaterThan(0);
  });

  // ── Default action (no command) ────────────────────────────────────────

  it("no command with AGENTBREW_NO_AUTO_INIT shows help hint", { timeout: CLI_TEST_TIMEOUT_MS }, async () => {
    const { stdout, stderr, exitCode } = await cli();
    const output = stdout + stderr;
    // With no state and auto-init disabled, should show help or init hint
    expect(exitCode).toBe(0);
    expect(output.length).toBeGreaterThan(0);
  });
});

describe("HELP_COMMAND_GROUPS", () => {
  // Guardrail added with PR that shipped help-output-group-orphans. Prevents
  // regressions like #747 (stale "team" entry survived deletion because
  // formatGroupedCommandSections silently skips unknown names).
  it("every name resolves to a registered non-hidden command", () => {
    const program = buildProgram();
    const registered = new Map(program.commands.map((c) => [c.name(), c]));

    const unresolved: string[] = [];
    const hidden: string[] = [];
    for (const group of HELP_COMMAND_GROUPS) {
      for (const name of group.names) {
        const cmd = registered.get(name);
        if (!cmd) {
          unresolved.push(`${group.title}:${name}`);
          continue;
        }
        if ((cmd as unknown as { _hidden?: boolean })._hidden) {
          hidden.push(`${group.title}:${name}`);
        }
      }
    }

    expect(unresolved, `help-group names with no matching command: ${unresolved.join(", ")}`).toEqual([]);
    expect(hidden, `help-group names that point at hidden commands: ${hidden.join(", ")}`).toEqual([]);
  });

  it("every name is unique across all groups", () => {
    const seen = new Map<string, string>();
    const duplicates: Array<{ name: string; firstGroup: string; secondGroup: string }> = [];
    for (const group of HELP_COMMAND_GROUPS) {
      for (const name of group.names) {
        const prior = seen.get(name);
        if (prior) {
          duplicates.push({ name, firstGroup: prior, secondGroup: group.title });
          continue;
        }
        seen.set(name, group.title);
      }
    }
    expect(duplicates).toEqual([]);
  });

  it("every group has a non-empty title and at least one name", () => {
    for (const group of HELP_COMMAND_GROUPS) {
      expect(group.title.length).toBeGreaterThan(0);
      expect(group.names.length).toBeGreaterThan(0);
    }
  });
});
