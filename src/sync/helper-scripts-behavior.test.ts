// Behavior tests for the helper scripts under templates/scripts/. Each
// script runs in a throwaway fixture repo, the way an agent runs it from
// ~/.config/agentbrew/scripts/ after `agentbrew sync`.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error — pure-ESM .mjs sibling; vitest resolves it via Node ESM.
import { checkPrVisionTrace } from "../../scripts/check-pr-vision-trace.mjs";

const SCRIPTS_DIR = resolve(import.meta.dirname, "..", "..", "templates", "scripts");

let repo: string;

function write(relativePath: string, content = "# doc\n"): void {
  const path = join(repo, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

// Drop GIT_DIR and friends (set inside git hooks) so `git rev-parse` sees the fixture, not this repo.
const SCRIPT_ENV = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));

function runScript(script: string, args: string[] = []) {
  const result = spawnSync("bash", [join(SCRIPTS_DIR, script), ...args], {
    cwd: repo,
    encoding: "utf-8",
    // The ceiling stops git from finding a repo that encloses the temp dir.
    env: { ...SCRIPT_ENV, GIT_CEILING_DIRECTORIES: dirname(repo) },
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "helper-script-repo-"));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("load-project-context.sh", () => {
  it("lists canonical root files, doc dirs, docs/ matches, Agentfile, and task backend", () => {
    write("README.md");
    write("AGENTS.md");
    write("vision.md");
    write("TASKS.md");
    write("src/index.ts", "export {};\n");
    write("user-stories/README.md");
    write("user-stories/us-01.md");
    write("docs/architecture-overview.md");
    write("docs/random-notes.md");
    write("docs/competition/skills-cli.md");
    write("Agentfile.yaml", "version: 1\n");
    write(".tasksmd.json", '{ "backend": "github-issues" }\n');

    const { status, out } = runScript("load-project-context.sh");

    expect(status).toBe(0);
    for (const entry of [
      "README.md",
      "AGENTS.md",
      "vision.md",
      "TASKS.md",
      "user-stories/ (2 files; index: user-stories/README.md)",
      "docs/architecture-overview.md",
      "docs/competition/ (1 file)",
    ]) {
      expect(out).toContain(entry);
    }
    expect(out).not.toContain("random-notes.md");
    expect(out).not.toContain("src/index.ts");
    expect(out).toContain("Agentfile: Agentfile.yaml");
    expect(out).toContain("task backend: github-issues");
    expect(out.indexOf("README.md")).toBeLessThan(out.indexOf("AGENTS.md"));
  });

  it("prints a graceful message when the directory has no canonical docs", () => {
    write("main.go", "package main\n");

    const { status, out } = runScript("load-project-context.sh");

    expect(status).toBe(0);
    expect(out).toContain("no canonical docs found");
  });

  it("caps the list and counts the entries it left out", () => {
    for (let i = 0; i < 45; i++) write(`docs/spec-${String(i).padStart(2, "0")}.md`);

    const { status, out } = runScript("load-project-context.sh");

    expect(status).toBe(0);
    expect(out).toContain("docs/spec-39.md");
    expect(out).not.toContain("docs/spec-40.md");
    expect(out).toContain("+5 more");
  });
});

describe("verify-vision-trace.sh", () => {
  const VISION_WITH_GOALS = [
    "---",
    "schema: vision-v1",
    "version: 1",
    "primary_agents:",
    "  # not a goal list",
    "  - claude-code",
    "goals:",
    "  - id: G1",
    "    name: Curate, not host",
    "    description: Reference skills; never duplicate: content.",
    "  - id: G2",
    '    name: "Generic first"',
    "non_goals:",
    "  - id: NG1",
    "    name: Per-agent config UI",
    "---",
    "",
    "# Vision",
    "",
  ].join("\n");

  function body(goalLine: string, extra = ""): string {
    return [
      "## Summary",
      "Text.",
      "",
      "## Vision trace",
      "",
      goalLine,
      "- **User story**: N/A — internal tooling",
      "- **Competitor prior art**: N/A — no corpus",
      extra,
    ].join("\n");
  }

  it("passes when every cited goal id exists", () => {
    write("docs/VISION.md", VISION_WITH_GOALS);
    write("pr.md", body("- **Vision goal**: G1 — Curate, not host (VISION.md § Strategy, uses S3 storage)"));

    const { status, out } = runScript("verify-vision-trace.sh", ["pr.md"]);

    expect(status).toBe(0);
    expect(out).toContain("VISION.md: docs/VISION.md");
    expect(out).toContain("schema: vision-v1");
    expect(out).toContain("goals declared: 2 (G1, G2)");
    expect(out).toContain("cited ids: G1");
    expect(out).toContain("✓ G1 — Curate, not host");
    expect(out).not.toContain("S3");
  });

  it("fails when a cited goal id is missing", () => {
    write("VISION.md", VISION_WITH_GOALS);
    write("pr.md", body("- Vision goal: G1, G7 — sync parity"));

    const { status, out } = runScript("verify-vision-trace.sh", ["pr.md"]);

    expect(status).toBe(1);
    expect(out).toContain("cited ids: G1, G7");
    expect(out).toContain("✓ G1 — Curate, not host");
    expect(out).toContain("✗ G7 — NOT FOUND in VISION.md goals list");
    expect(out).toContain("exit 1 — 1 invalid goal id");
  });

  it("warns and passes when VISION.md has no frontmatter", () => {
    write("VISION.md", "# Vision\n\nProse only.\n");
    write("pr.md", body("- Vision goal: G9 — anything"));

    const { status, out } = runScript("verify-vision-trace.sh", ["pr.md"]);

    expect(status).toBe(0);
    expect(out).toContain("VISION.md lacks frontmatter — validation skipped");
    expect(out).toContain("P3");
  });

  it("warns and passes when the frontmatter declares no goals yet", () => {
    write("vision.md", "---\nschema: vision-v1\ngoals: []\n---\n# Vision\n");
    write("pr.md", body("- Vision goal: permanent-scope-tick-loop"));

    const { status, out } = runScript("verify-vision-trace.sh", ["pr.md"]);

    expect(status).toBe(0);
    expect(out).toContain("validation skipped");
  });

  it("skips an N/A vision goal", () => {
    write("VISION.md", VISION_WITH_GOALS);
    write("pr.md", body("- **Vision goal**: N/A — lockfile-only update"));

    const { status, out } = runScript("verify-vision-trace.sh", ["pr.md"]);

    expect(status).toBe(0);
    expect(out).toContain("Vision goal: N/A — lockfile-only update (skipped)");
  });

  it("skips the whole check for the opt-out marker", () => {
    write("VISION.md", VISION_WITH_GOALS);
    write("pr.md", "Lockfile bump.\n<!-- vision-trace: not-applicable — dependabot lockfile bump -->\n");

    const { status, out } = runScript("verify-vision-trace.sh", ["pr.md"]);

    expect(status).toBe(0);
    expect(out).toContain("opt-out");
  });

  it("finds VISION.md under .minsky/", () => {
    write(".minsky/VISION.md", VISION_WITH_GOALS);
    write("pr.md", body("- Vision goal: G2 — generic first"));

    const { status, out } = runScript("verify-vision-trace.sh", ["pr.md"]);

    expect(status).toBe(0);
    expect(out).toContain("VISION.md: .minsky/VISION.md");
    expect(out).toContain("✓ G2 — Generic first");
  });

  it.each([
    "<!-- vision-trace: not-applicable — dependabot lockfile bump -->",
    "<!-- Vision Trace: Not Applicable: release bot -->",
    "<!-- vision-trace: not-applicable — ab -->",
    "<!-- vision-trace: not-applicable lockfile bump -->",
    "<!-- vision-trace: not-applicable — no closing marker",
  ])("agrees with check-pr-vision-trace.mjs on the opt-out marker %s", (marker) => {
    write("VISION.md", VISION_WITH_GOALS);
    const prBody = `Lockfile bump.\n${marker}\n`;
    write("pr.md", prBody);

    const { out } = runScript("verify-vision-trace.sh", ["pr.md"]);

    const gate = checkPrVisionTrace(prBody) as { ok: boolean; reason?: string };
    const gateOptOut = gate.ok && (gate.reason ?? "").startsWith("opt-out");
    expect(out.includes("skipped (opt-out")).toBe(gateOptOut);
  });

  it("fails when the PR body has no Vision goal line", () => {
    write("VISION.md", VISION_WITH_GOALS);
    write("pr.md", "## Summary\nNo trace block.\n");

    const { status, out } = runScript("verify-vision-trace.sh", ["pr.md"]);

    expect(status).toBe(1);
    expect(out).toContain("no `Vision goal:` line");
  });

  it("exits 2 with usage when the PR body file is missing", () => {
    const { status, out } = runScript("verify-vision-trace.sh", ["missing.md"]);

    expect(status).toBe(2);
    expect(out).toContain("usage");
  });
});

describe("competitor-spot-check.sh", () => {
  it("prints citation-ready matches with competitor name, path, and line", () => {
    write(
      "docs/competition/skills-cli-vs-agentbrew.md",
      [
        "# skills-cli",
        "",
        "Unrelated line.",
        "skills-cli installs a skill from a GitHub URL with `skills add`.",
        "",
      ].join("\n"),
    );
    write("docs/competition/mcpm-sh-vs-agentbrew.md", "# mcpm\n\nmcpm installs MCP servers.\n");

    const { status, out } = runScript("competitor-spot-check.sh", ["skill installation from GitHub URL"]);

    expect(status).toBe(0);
    expect(out).toContain(
      "[skills-cli] skills-cli installs a skill from a GitHub URL with `skills add`. (docs/competition/skills-cli-vs-agentbrew.md:4)",
    );
    expect(out).not.toContain("Unrelated line");
  });

  it("names the competitor by heading in a single-file corpus", () => {
    write("COMPETITORS.md", "# Competitors\n\n## Acme Sync\n\nAcme ships team presets for skills.\n");

    const { status, out } = runScript("competitor-spot-check.sh", ["team skill presets"]);

    expect(status).toBe(0);
    expect(out).toContain("[Acme Sync] Acme ships team presets for skills. (COMPETITORS.md:5)");
  });

  it("reports an honest no-match result with the scanned file count", () => {
    write("competitors/a.md", "# a\nnothing here\n");
    write("competitors/b.md", "# b\nstill nothing\n");

    const { status, out } = runScript("competitor-spot-check.sh", ["inline dashboard widget"]);

    expect(status).toBe(0);
    expect(out).toContain("no prior art found in 2 competitor files scanned");
  });

  it("reports when the repo has no competitive corpus", () => {
    write("README.md");

    const { status, out } = runScript("competitor-spot-check.sh", ["skill presets"]);

    expect(status).toBe(0);
    expect(out).toContain("no competitive corpus in this repo");
  });

  it("asks for specific terms when the description is only stopwords", () => {
    write("docs/competition.md", "# x\nanything\n");

    const { status, out } = runScript("competitor-spot-check.sh", ["make this work"]);

    expect(status).toBe(0);
    expect(out).toContain("only stopwords");
  });

  it("caps output at 20 matches", () => {
    const lines = Array.from({ length: 25 }, (_, i) => `agent skills line ${i}`);
    write("docs/competitors/big.md", `${lines.join("\n")}\n`);

    const { status, out } = runScript("competitor-spot-check.sh", ["agent skills"]);

    expect(status).toBe(0);
    expect(out.match(/^\[big\]/gm)).toHaveLength(20);
    expect(out).toContain("+5 more matches — refine search keywords");
  });
});
