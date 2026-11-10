import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Pins the safety contract of the hosted workflows (docs/ci.md): a public
// repo runs code from strangers' pull requests, so each rule here closes one
// way a workflow could leak a token or run with more rights than it needs.
const workflowsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".github", "workflows");
const workflows = readdirSync(workflowsDir)
  .filter((name) => name.endsWith(".yml"))
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
      expect(line).toMatch(/uses:\s*[\w.-]+\/[\w./-]+@[0-9a-f]{40}\s+#\s*v\d/);
    }
  });

  it.each(workflows)("$name sets top-level permissions", ({ text }) => {
    expect(codeLines(text).some((line) => /^permissions:/.test(line))).toBe(true);
  });

  it.each(workflows)("$name never runs fork code with repo rights or secrets", ({ text }) => {
    const code = codeLines(text).join("\n");
    expect(code).not.toMatch(/pull_request_target/);
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

  it("the release workflow starts only by hand", () => {
    const text = workflows.find((w) => w.name === "auto-publish.yml")?.text ?? "";
    const code = codeLines(text).join("\n");
    expect(code).toMatch(/^on:\n\s+workflow_dispatch:/m);
    expect(code).not.toMatch(/^\s+push:/m);
  });

  it("ci.yml runs the same gate as a local checkout", () => {
    const text = workflows.find((w) => w.name === "ci.yml")?.text ?? "";
    expect(text).toMatch(/run: npm run verify$/m);
    expect(text).toMatch(/persist-credentials: false/);
    expect(text).toMatch(/cancel-in-progress:/);
  });
});
