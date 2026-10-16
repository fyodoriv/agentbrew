import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");

/** Rule numbers in the AGENTS.md "## Rules" list ("1.", "8a."). */
function agentsRuleNumbers(): string[] {
  const text = readFileSync(join(ROOT, "AGENTS.md"), "utf-8");
  const section = text.split("\n## Rules\n")[1]?.split("\n## ")[0] ?? "";
  return [...section.matchAll(/^(\d+[a-z]?)\. /gm)].map((m) => m[1]);
}

/** Rows of the "How each rule is enforced" table in docs/editing-rules.md. */
function enforcementRows(): Map<string, string> {
  const text = readFileSync(join(ROOT, "docs", "editing-rules.md"), "utf-8");
  const section = text.split("\n## How each rule is enforced\n")[1]?.split("\n## ")[0] ?? "";
  const rows = new Map<string, string>();
  for (const m of section.matchAll(/^\| (\d+[a-z]?) \| (.+) \|$/gm)) rows.set(m[1], m[2]);
  return rows;
}

describe("AGENTS.md rule enforcement map", () => {
  it("has a row for every numbered rule, and no row for a rule that is gone", () => {
    const rules = agentsRuleNumbers();
    expect(rules.length).toBeGreaterThan(0);
    expect([...enforcementRows().keys()]).toEqual(rules);
  });

  it("names a check or says advisory with a reason", () => {
    for (const [rule, text] of enforcementRows()) {
      expect(/^(Hooks?|Tests?) `/.test(text) || /^Advisory[^:]*: \S/.test(text), `rule ${rule}: ${text}`).toBe(true);
    }
  });

  it("points only at files that exist", () => {
    const missing = [...enforcementRows().values()]
      .flatMap((text) => [...text.matchAll(/`([\w./-]+\/[\w.-]+\.(?:sh|ts|mjs))`/g)].map((m) => m[1]))
      .filter((path) => !existsSync(join(ROOT, path)));
    expect(missing).toEqual([]);
  });
});
