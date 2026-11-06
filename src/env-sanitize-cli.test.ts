import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify, stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const repo = join(import.meta.dirname, "..");
const entry = join(repo, "src/cli.ts");
const loader = pathToFileURL(join(repo, "node_modules/tsx/dist/loader.mjs")).href;
const { version } = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
let home: string;

function fixtureEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    HOME: home,
    USERPROFILE: home,
    PATH: `${join(home, "bin")}:${dirname(process.execPath)}:/usr/bin:/bin`,
    AGENTBREW_NO_AUTO_INIT: "1",
    AGENTBREW_EVENTS: "0",
    NO_COLOR: "1",
    ...extra,
  };
}

function cli(args: string[], extra: NodeJS.ProcessEnv = {}) {
  return run(process.execPath, ["--import", loader, entry, ...args], {
    cwd: home,
    env: fixtureEnv(extra),
    timeout: 60_000,
  });
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "agentbrew-sanitize-cli-"));
  const config = join(home, ".config/agentbrew");
  mkdirSync(config, { recursive: true });
  mkdirSync(join(home, "bin"));
  writeFileSync(join(config, "state.yaml"), "schemaVersion: 1\nagents: []\ncatalogVersion: '0.1.0'\n");
  writeFileSync(
    join(config, "upgrade-check.json"),
    JSON.stringify({ checkedAt: new Date().toISOString(), latestVersion: version }),
  );
  // The real CLI may ask only for a global prefix. Other npm work is forbidden in this fixture.
  writeFileSync(
    join(home, "bin/npm"),
    '#!/bin/sh\nif [ "$1" = prefix ] && [ "$2" = -g ] && [ "$#" = 2 ]; then printf "/fixture-not-global\\n"; else exit 97; fi\n',
    { mode: 0o700 },
  );
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  expect(existsSync(home)).toBe(false);
});

describe("real sanitize CLI shell output", () => {
  it("keeps clean stdout empty while banner, repair and status remain visible on stderr", {
    timeout: 65_000,
  }, async () => {
    writeFileSync(
      join(home, ".config/agentbrew/repair-log.json"),
      JSON.stringify({
        repairedAt: new Date().toISOString(),
        actions: [{ type: "fixture repair", agent: "fixture", detail: "synthetic" }],
      }),
    );
    const result = await cli(["env", "sanitize"]);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("⚡");
    expect(result.stderr).toContain("Auto-repaired since last run");
    expect(result.stderr).toContain("No dangerous env vars to unset");
  });

  it("prints only unset code and never interpolates environment values", { timeout: 65_000 }, async () => {
    const value = "fixture; printf INJECTED_VALUE";
    const result = await cli(["env", "sanitize"], { ANTHROPIC_MODEL: value, OPENAI_MODEL: "fixture-model" });
    expect(result.stdout).toBe("unset ANTHROPIC_MODEL OPENAI_MODEL\n");
    expect(result.stderr).toContain("⚡");
    expect(result.stdout + result.stderr).not.toContain(value);
  });

  it("keeps a cached upgrade notice off shell stdout", { timeout: 65_000 }, async () => {
    writeFileSync(
      join(home, ".config/agentbrew/upgrade-check.json"),
      JSON.stringify({ checkedAt: new Date().toISOString(), latestVersion: "99.0.0" }),
    );
    const result = await cli(["env", "sanitize"]);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Update available:");
  });

  it("can be consumed in an isolated shell without banner commands or retained variables", {
    timeout: 65_000,
  }, async () => {
    const result = await run(
      "/bin/sh",
      [
        "-c",
        'set -eu\neval "$("$1" --import "$2" "$3" env sanitize)"\ntest "${ANTHROPIC_MODEL+x}" != x\nprintf "SHELL_OK\\n"',
        "fixture",
        process.execPath,
        loader,
        entry,
      ],
      {
        cwd: home,
        env: fixtureEnv({ ANTHROPIC_MODEL: "fixture-model" }),
        timeout: 60_000,
      },
    );
    expect(result.stdout).toBe("SHELL_OK\n");
    expect(result.stderr).toContain("⚡");
    expect(result.stderr).not.toMatch(/not found|syntax error/);
  });

  it("preserves the ordinary env check banner on stdout", { timeout: 65_000 }, async () => {
    const result = await cli(["env", "check"]);
    expect(result.stdout).toContain("⚡");
    expect(result.stdout).toContain("No dangerous env vars detected");
    expect(result.stderr).not.toContain("⚡");
  });

  it.each([
    ["--", "env", "sanitize"],
    ["env", "--", "sanitize"],
    ["env", "sanitize", "--"],
  ])("keeps shell output clean with command separators: %j", { timeout: 65_000 }, async (...args) => {
    const result = await cli(args);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("⚡");
  });

  it("preserves the root version flag before command words", { timeout: 65_000 }, async () => {
    const result = await cli(["--version", "env", "sanitize"]);
    expect(result.stdout).toBe(`${version}\n`);
    expect(result.stderr).not.toContain("⚡");
  });

  it("does not treat later words of another command as sanitize dispatch", { timeout: 65_000 }, async () => {
    const result = await cli(["telemetry", "status", "env", "sanitize"]);
    expect(result.stdout).toContain("⚡");
    expect(result.stdout).toContain("telemetry:");
    expect(result.stderr).not.toContain("⚡");
  });

  it("preserves the existing env help banner stream", { timeout: 65_000 }, async () => {
    const result = await cli(["env", "--help"]);
    expect(result.stdout).toContain("⚡");
    expect(result.stdout).toContain("Usage:");
    expect(result.stderr).not.toContain("⚡");
  });
});

describe("real env check value privacy", () => {
  const privacyCases = [
    ["C01", "ANTHROPIC_MODEL", true],
    ["C02", "OPENAI_MODEL", true],
    ["C03", "CLAUDE_MODEL", true],
    ["C04", "CLAUDECODE", false],
    ["C05", "CLAUDE_CODE_USE_BEDROCK", true],
    ["C06", "CLAUDE_CODE_USE_VERTEX", true],
    ["C07", "OPENAI_API_KEY", false],
    ["C08", "ANTHROPIC_API_KEY", true],
  ] as const;

  it.each(privacyCases)("%s reports %s without its value", { timeout: 65_000 }, async (id, variable, long) => {
    const marker = `SYNTHETIC_VALUE_${id}_`;
    const value = marker + (long ? "Z".repeat(64) : "");
    const result = await new Promise<{
      code: number | string;
      signal: NodeJS.Signals | null;
      stdout: string;
      stderr: string;
    }>((resolve) => {
      execFile(
        process.execPath,
        ["--import", loader, entry, "env", "check"],
        {
          cwd: home,
          env: fixtureEnv({ [variable]: value }),
          timeout: 60_000,
        },
        (error, stdout, stderr) => {
          resolve({ code: error?.code ?? 0, signal: error?.signal ?? null, stdout, stderr });
        },
      );
    });
    const stdout = stripVTControlCharacters(result.stdout);
    const stderr = stripVTControlCharacters(result.stderr);
    const output = stdout + stderr;
    expect.soft(result.code).toBe(1);
    expect.soft(result.signal).toBeNull();
    expect.soft(stdout).toContain("⚡");
    expect.soft(stderr).not.toContain("⚡");
    expect.soft(stderr).toContain("1 env var(s)");
    expect.soft(stdout.split("\n").filter((line) => line.includes(variable))).toEqual([`  ${variable} is set`]);
    expect.soft(output).not.toContain(value);
    expect.soft(output).not.toContain(marker);
    expect(output).not.toContain("SYNTHETIC_");
  });
});
