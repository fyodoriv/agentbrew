import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

// Skills removed in the 2026-07 shrink. Active guidance must not route agents to them.
const DELETED_SKILL_PATTERN = /\b(?:find-jira-task|jira-task)\b|\*\*`jira`\*\* skill|`jira` skill/;

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listFiles(path);
    return /\.(md|json)$/.test(name) ? [path] : [];
  });
}

describe("references to deleted Jira workflow skills", () => {
  it("are gone from built-in skills and shared rules", () => {
    const files = [
      ...listFiles(join(REPO_ROOT, "skill-plugins")),
      join(REPO_ROOT, "docs", "shared-rules.md"),
      join(REPO_ROOT, "templates", "AGENTS.md"),
    ];
    const offenders = files.filter((file) => DELETED_SKILL_PATTERN.test(readFileSync(file, "utf-8")));
    expect(offenders.map((file) => relative(REPO_ROOT, file))).toEqual([]);
  });
});
