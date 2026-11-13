import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Pins the safety contract of the hosted workflows (docs/ci.md): a public
// repo runs code from strangers' pull requests, so each rule here closes one
// way a workflow could leak a token or run with more rights than it needs.
const workflowsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".github", "workflows");
const workflows = readdirSync(workflowsDir)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({ name, text: readFileSync(join(workflowsDir, name), "utf8") }));

/** Lines that are not YAML comments. */
function codeLines(text: string): string[] {
  return text.split("\n").filter((line) => !line.trim().startsWith("#"));
}

describe("hosted workflows", () => {
  it("finds the workflows", () => {
    expect(workflows.map((w) => w.name)).toContain("ci.yml");
  });

  it.each(workflows)("$name pins every action to a full commit SHA", ({ text }) => {
    const uses = codeLines(text).filter((line) => /^\s*(-\s*)?uses:/.test(line));
    for (const line of uses) {
      // Only GitHub-owned actions, each at a full commit SHA.
      expect(line).toMatch(/uses:\s*(actions|github)\/[\w./-]+@[0-9a-f]{40}\s+#\s*v\d/);
    }
  });

  it.each(workflows)("$name sets top-level permissions", ({ text }) => {
    expect(codeLines(text).some((line) => /^permissions:/.test(line))).toBe(true);
  });

  it.each(workflows)("$name never runs fork code with repo rights or secrets", ({ text }) => {
    const code = codeLines(text).join("\n");
    expect(code).not.toMatch(/pull_request_target|workflow_run|issue_comment/);
    // Event text (a PR title, a branch name) may steer a job, never a script.
    const eventLines = codeLines(text).filter((line) => line.includes("github.event."));
    for (const line of eventLines) {
      expect(line.trim()).toMatch(/^(if|group|cancel-in-progress):/);
    }
    expect(code).not.toMatch(/\$\{\{\s*secrets\./);
    // A step that prints the environment could expose values in a public log.
    expect(code).not.toMatch(/^\s*(-\s*)?run:\s*(env|printenv|set)\s*$/m);
  });

  it("only the release workflow may write to the repository", () => {
    for (const { name, text } of workflows) {
      if (name === "auto-publish.yml") continue;
      expect(codeLines(text).join("\n"), name).not.toMatch(/:\s*write\b/);
    }
  });

  it("every workflow starts only from its allowed triggers", () => {
    // A new trigger is a decision: add it here in the same change.
    const allowed: Record<string, string[]> = {
      "auto-publish.yml": ["workflow_dispatch"],
      "ci.yml": ["pull_request", "push", "workflow_dispatch"],
      "oss-readiness.yml": ["pull_request", "push", "workflow_dispatch"],
      "pr-vision-trace.yml": ["workflow_dispatch"],
      "publish.yml": ["push"],
      "supermemory-local-trial.yml": ["pull_request", "workflow_dispatch"],
    };
    for (const { name, text } of workflows) {
      const code = codeLines(text).join("\n");
      const on = code.match(/^on:\n((?:[ \t]+.*\n|\n)*)/m)?.[1] ?? "";
      const keys = on
        .split("\n")
        .filter((line) => /^ {2}\S/.test(line))
        .map((line) => line.trim().replace(/:.*$/, ""));
      expect(keys, name).toEqual(allowed[name] ?? []);
    }
  });

  it("the release workflow bumps the version on main only", () => {
    const text = workflows.find((w) => w.name === "auto-publish.yml")?.text ?? "";
    expect(text).toMatch(/if: github\.ref == 'refs\/heads\/main'/);
  });

  it.each(workflows)("$name gives every job a time limit", ({ text }) => {
    const jobs = codeLines(text).filter((line) => /^\s+runs-on:/.test(line)).length;
    const limits = codeLines(text).filter((line) => /^\s+timeout-minutes:/.test(line)).length;
    expect(limits).toBe(jobs);
  });

  it("ci.yml runs the same gate as a local checkout", () => {
    const text = workflows.find((w) => w.name === "ci.yml")?.text ?? "";
    expect(text).toMatch(/run: npm run verify$/m);
    expect(text).toMatch(/persist-credentials: false/);
    expect(text).toMatch(/cancel-in-progress:/);
  });
});
