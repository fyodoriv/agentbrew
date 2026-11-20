import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateBuiltInSkills } from "./skill-coverage.js";

// `skills:coverage` passes at 90%, so one broken skill can slip through it.
// Every built-in skill must parse, or agents skip it at load time.
const repo = resolve(import.meta.dirname, "..", "..");

describe("built-in skills", () => {
  it.each(["dev", "workflow"])("every skill-plugins/%s skill has no validation errors", (folder) => {
    const results = validateBuiltInSkills(join(repo, "skill-plugins", folder));
    const errors = results.flatMap(({ name, issues }) =>
      issues.filter(({ severity }) => severity === "error").map(({ message }) => `${name}: ${message}`),
    );
    expect(results.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
});
