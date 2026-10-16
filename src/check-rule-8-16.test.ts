// Tests for scripts/check-rule-8-pattern-conformance.mjs and
// scripts/check-rule-16-defaults.mjs. Each runs against a small fixture repo,
// plus once against this repo so a new flag or index row cannot slip in.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const rule8 = join(root, "scripts/check-rule-8-pattern-conformance.mjs");
const rule16 = join(root, "scripts/check-rule-16-defaults.mjs");
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const dirs: string[] = [];

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "agentbrew-rule-8-16-"));
  dirs.push(dir);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  execFileSync("git", ["init", "-q"], { cwd: dir, env, stdio: "ignore" });
  execFileSync("git", ["add", "-A"], { cwd: dir, env, stdio: "ignore" });
  return dir;
}

function run(script: string, repo: string): { status: number | null; json: Record<string, unknown> } {
  const result = spawnSync(process.execPath, [script, "--repo", repo, "--json"], { encoding: "utf8", env });
  return { status: result.status, json: JSON.parse(result.stdout || "{}") };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function visionWith(rows: string[]): string {
  return [
    "# Vision",
    "",
    "## Pattern conformance index",
    "",
    "| Artifact | Pattern | Source | Conformance | Notes |",
    "|---|---|---|---|---|",
    ...rows,
    "",
    "## Next",
    "",
  ].join("\n");
}

function rowsFor(count: number): { rows: string[]; files: Record<string, string> } {
  const rows: string[] = [];
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    rows.push(`| \`src/m${i}.ts\` | Adapter | Gamma 1994 | full | note |`);
    files[`src/m${i}.ts`] = "// Pattern: Adapter (Gamma 1994).\nexport {};\n";
  }
  return { rows, files };
}

describe("check-rule-8-pattern-conformance", () => {
  it("passes this repo's VISION.md index", () => {
    expect(run(rule8, root)).toMatchObject({ status: 0, json: { problems: [] } });
  });

  it("passes a complete index whose files cite their pattern", () => {
    const { rows, files } = rowsFor(15);
    const repo = fixture({ "VISION.md": visionWith(rows), ...files });
    expect(run(rule8, repo).status).toBe(0);
  });

  it("fails a short index, a missing file, a silent deviation, and a missing citation", () => {
    const { rows, files } = rowsFor(3);
    rows.push("| `src/gone.ts` | Adapter | Gamma 1994 | full | note |");
    rows.push("| `src/m0.ts` | Strategy | Gamma 1994 | mostly | note |");
    const repo = fixture({ "VISION.md": visionWith(rows), ...files });
    const { status, json } = run(rule8, repo);
    const problems = (json.problems as string[]).join("\n");
    expect(status).toBe(1);
    expect(problems).toContain("at least 15 are required");
    expect(problems).toContain("src/gone.ts: file does not exist");
    expect(problems).toContain('conformance "mostly"');
    expect(problems).toContain('must say "Pattern: Strategy"');
  });
});

describe("check-rule-16-defaults", () => {
  it("passes this repo's flag audit", () => {
    expect(run(rule16, root)).toMatchObject({ status: 0, json: { unjustified_flags: [], stale_rows: [] } });
  });

  it("flags a new option with no audit row, a stale row, and a bad category", () => {
    const repo = fixture({
      "src/cli.ts": 'program.option("--dry-run", "x").option(\n  "-n, --new-thing <v>",\n  "y",\n);\n',
      "src/cli.test.ts": 'program.option("--only-in-test", "z");\n',
      "docs/cli-flags-audit.md": [
        "| Flag | Category | Why |",
        "|---|---|---|",
        "| `--dry-run` | debug | Preview only. |",
        "| `--removed` | knob | Gone now. |",
        "| `--dry-run-two` | sometimes | Bad category. |",
        "",
      ].join("\n"),
    });
    const { status, json } = run(rule16, repo);
    expect(status).toBe(1);
    expect(json.unjustified_flags).toEqual(["--new-thing"]);
    expect(json.stale_rows).toEqual(["--dry-run-two", "--removed"]);
    expect(json.bad_rows).toEqual(["--dry-run-two"]);
  });
});
