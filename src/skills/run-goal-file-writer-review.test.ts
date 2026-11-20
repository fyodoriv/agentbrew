import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const skill = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");

describe("run-goal scripted edit and file writer review (#1021)", () => {
  it("requires a whole-line anchor, full diff, and file-writer edge cases before merge", () => {
    const execution = readFileSync(join(skill, "references", "execution.md"), "utf8");
    expect(execution).toContain("require one exact whole-line anchor");
    expect(execution).toContain("Before running tests, read the full `git diff` for each changed file");
    expect(execution).toMatch(/links at\s+the target and in its parent path, a directory or named pipe/);
    expect(execution).toContain("unset `HOME`");
    expect(execution).toMatch(/without replacing a\s+destination that appears after validation/);
    expect(execution).toMatch(/status reads only a\s+verified regular file and returns promptly for a named pipe/);
  });

  it("pins both lost lines and all five reviewer checks in the synthetic case", () => {
    const { evals } = JSON.parse(readFileSync(join(skill, "evals", "evals.json"), "utf8")) as {
      evals: Array<{ prompt: string; expected_output: string }>;
    };
    const cases = evals.filter(({ prompt }) => prompt.startsWith("/goal add a sink-file writer"));
    expect(cases).toHaveLength(1);
    const scenario = cases[0];
    expect(scenario.prompt).toContain("POLICY= also appears in a header comment");
    expect(scenario.expected_output).toContain("restore set -uo pipefail and umask 077 before tests");
    expect(scenario.expected_output).toContain("link at the target or parent path");
    expect(scenario.expected_output).toContain("directory or named pipe target");
    expect(scenario.expected_output).toContain("unset HOME");
    expect(scenario.expected_output).toContain("preserve a late-arriving destination");
    expect(scenario.expected_output).toContain("status reports the named pipe promptly without reading it");
  });
});
