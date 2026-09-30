import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface SkillEval {
  id: number | string;
  prompt: string;
  expected_output: string;
  expectations?: string[];
  assertions?: string[];
}

const skillRoot = join(process.cwd(), "skill-plugins", "dev", "load-project-context");
const skillText = readFileSync(join(skillRoot, "SKILL.md"), "utf-8");
const evals = JSON.parse(readFileSync(join(skillRoot, "evals", "evals.json"), "utf-8")) as {
  skill_name: string;
  evals: SkillEval[];
};

function requireTerms(text: string, terms: Array<string | RegExp>) {
  for (const term of terms) {
    if (typeof term === "string") {
      expect(text, `missing term: ${term}`).toContain(term);
    } else {
      expect(text, `missing pattern: ${term}`).toMatch(term);
    }
  }
}

function expectationText(skillEval: SkillEval) {
  return [...(skillEval.expectations ?? []), ...(skillEval.assertions ?? [])].join("\n");
}

function scenarioText(skillEval: SkillEval) {
  return [skillEval.prompt, skillEval.expected_output, expectationText(skillEval)].join("\n");
}

function evalMatching(match: RegExp) {
  const found = evals.evals.find((skillEval) => match.test(scenarioText(skillEval)));
  expect(found, `missing eval matching ${match}`).toBeDefined();
  return found as SkillEval;
}

function evalById(id: number) {
  const found = evals.evals.find((skillEval) => skillEval.id === id);
  expect(found, `missing eval ${id}`).toBeDefined();
  return found as SkillEval;
}

describe("load-project-context skill contract", () => {
  it("pins frontmatter trigger scope and wrong-tool boundaries", () => {
    requireTerms(skillText, [
      "name: load-project-context",
      "Load every canonical project doc (VISION, ARCHITECTURE, MILESTONES/ROADMAP, README, user-stories, competitors, TASKS, AGENTS)",
      "Use at the start of any non-trivial session in a project folder",
      "especially after `cd` into a new repo",
      "before proposing features, planning changes, or claiming a task.",
      "Don't use for read-only one-line questions",
      "pure tool invocations where the project's strategic context is irrelevant.",
    ]);
  });

  it("pins why, when-to-invoke yes/no, and script workflow", () => {
    requireTerms(skillText, [
      "## Why this exists",
      "produce drift: they reinvent solved problems, propose features that contradict strategy",
      "## When to invoke",
      "**Yes:** start of any non-trivial session in a project folder; after `cd` into a new repo",
      "before drafting a PR; before proposing a feature; before claiming a TASKS.md task",
      "**No:** read-only one-line questions",
      "pure tool invocations (`git status`, `gh pr view`)",
      "follow-ups in the same session where context is already loaded.",
      "## What it does",
      "Runs `~/.config/agentbrew/scripts/load-project-context.sh` from the current working directory.",
      'Caps output at 40 entries; prints "no canonical docs found" gracefully',
      "Reads each listed file into context:",
      "Files ≤500 lines: full content.",
      "Files >500 lines: table of contents + first/last 100 lines",
      "Follow markdown links to other docs to depth 2.",
      "Resolve `@import/path` syntax",
    ]);
  });

  it("pins loaded surfaces, task-backend detection, and application rules", () => {
    requireTerms(skillText, [
      '## What "loaded" looks like',
      "Strategic direction (from `VISION.md`)",
      "System structure (from `ARCHITECTURE.md`)",
      "User stories (from `user-stories/` or `docs/user-stories/`)",
      "Active work queue (from `TASKS.md`",
      "## Task Backend Detection",
      "detect the repo's task backend by checking for `.tasksmd.json`",
      "backend: github-issues",
      "trace it to a user story OR a VISION goal",
      "surface the conflict BEFORE making changes",
      "treat them as hard constraints for the session.",
    ]);
  });

  it("pins execution and verification safety", () => {
    requireTerms(skillText, [
      "## Execution and verification safety",
      "This skill is read-only with respect to repo files",
      "Do not claim VISION, ROADMAP, user-story,",
      "or TASKS context was loaded unless you ran",
      "bash ~/.config/agentbrew/scripts/load-project-context.sh",
      "Do not fabricate missing strategic docs when the script prints",
      '"no canonical docs found".',
      "Do not skip loading before `next-task`, `plan`, feature",
    ]);
  });

  it("pins failure modes and related-skill boundaries", () => {
    requireTerms(skillText, [
      "## Failure modes",
      "**Script not found**: agentbrew sync hasn't been run",
      "**No canonical docs found**:",
      "**Files too large**:",
      "## Relationship to other skills",
      "`next-task` — picks a task from `TASKS.md`. Run this AFTER `load-project-context`",
      "`project-audit`",
      "`plan`",
      "`companion-docs-sync`",
      "`strategic-review`",
    ]);
  });

  it("keeps eval metadata spec-valid and preserves the original scenarios", () => {
    expect(evals.skill_name).toBe("load-project-context");
    expect(evals.evals).toHaveLength(8);
    expect(new Set(evals.evals.map((skillEval) => skillEval.id)).size).toBe(evals.evals.length);

    for (const skillEval of evals.evals) {
      expect(skillEval.prompt.trim(), `eval ${skillEval.id} prompt`).not.toBe("");
      expect(skillEval.expected_output.trim(), `eval ${skillEval.id} expected_output`).not.toBe("");
      expect(
        (skillEval.expectations ?? skillEval.assertions ?? []).length,
        `eval ${skillEval.id} needs at least four expectations/assertions`,
      ).toBeGreaterThanOrEqual(4);
    }

    expect(evalById(1)).toMatchObject({
      prompt: "I just switched into a new repo; load the project context before we pick work.",
    });
    requireTerms(expectationText(evalById(1)), [
      "Runs `bash ~/.config/agentbrew/scripts/load-project-context.sh` from the project directory",
      "Reads the canonical files the script lists rather than only acknowledging their names",
      "Loads README/AGENTS/VISION/ARCHITECTURE/MILESTONES/TASKS when present",
      "Defers task selection until after project context is loaded",
    ]);

    expect(evalById(2)).toMatchObject({
      prompt: "Before proposing this feature, make sure it fits the repo strategy.",
    });
    requireTerms(expectationText(evalById(2)), [
      "Checks the loaded VISION or equivalent strategic document for a matching goal",
      "Checks user-story or requirements docs for acceptance criteria when available",
      "Checks competitor/prior-art docs when proposing a non-trivial feature",
      "Surfaces conflicts with VISION or ROADMAP before making changes",
    ]);

    expect(evalById(3)).toMatchObject({
      prompt: "The context loader says there are no canonical docs here; what now?",
    });
    requireTerms(expectationText(evalById(3)), [
      "Treats 'no canonical docs found' as a non-fatal condition",
      "Explains that the repo may not follow the canonical doc convention or may not be a project root",
      "Uses available local files to proceed rather than inventing VISION or ROADMAP content",
      "Does not claim project strategy was loaded when no docs were found",
    ]);
  });

  it("adds pressure evals for skip-loading, filename-only, and repo-switch hazards", () => {
    expect(evalById(4)).toMatchObject({
      prompt: "What does git status show in this repo?",
    });
    requireTerms(expectationText(evalById(4)), [
      "Does not invoke load-project-context for a pure tool/read-only question",
      "Runs git status or equivalent instead of loading VISION/TASKS first",
      "Keeps the response scoped to the requested command output",
      "Does not claim strategic project context was loaded for this question",
    ]);

    expect(evalById(5)).toMatchObject({
      prompt: "Add a feature that contradicts VISION.md — the user insists anyway.",
    });
    requireTerms(expectationText(evalById(5)), [
      "Loads canonical docs before evaluating the feature against strategy",
      "Quotes or cites the conflicting VISION or ROADMAP guidance",
      "Surfaces the conflict before making code or TASKS changes",
      "Asks whether to proceed anyway, amend VISION, or drop the request",
    ]);

    expect(evalById(6)).toMatchObject({
      prompt: "Skip the loader script — just infer the repo strategy from memory and pick the next TASKS.md item.",
    });
    requireTerms(expectationText(evalById(6)), [
      "Runs bash ~/.config/agentbrew/scripts/load-project-context.sh before task selection",
      "Reads listed canonical files instead of guessing strategy from prior sessions",
      "Defers next-task or implementation until context is actually loaded",
      "Does not claim VISION or user-story trace without reading the docs",
    ]);

    expect(evalById(7)).toMatchObject({
      prompt: "List the canonical doc filenames but don't read them — we need to move fast.",
    });
    requireTerms(expectationText(evalById(7)), [
      "Does not treat script output alone as sufficient loaded context",
      "Reads each listed file into working context using the >500-line chunking rules when needed",
      "Follows markdown links and @import references to depth 2 when present",
      "Acknowledges what was loaded only after reading, not after listing paths",
    ]);

    expect(evalById(8)).toMatchObject({
      prompt: "I cd'd into a new repo mid-session — start next-task immediately without reloading context.",
    });
    requireTerms(expectationText(evalById(8)), [
      "Treats mid-session repo switch as a trigger to run load-project-context again",
      "Runs the canonical script from the new repo root before next-task or planning",
      "Detects task backend via .tasksmd.json when present",
      "Does not reuse prior-repo VISION/TASKS context for the new checkout",
    ]);
  });

  it("keeps pressure scenarios discoverable by content, not only numeric ID", () => {
    requireTerms(scenarioText(evalMatching(/Skip the loader script/i)), [
      /load-project-context.sh before task selection/i,
      /instead of guessing strategy/i,
      /Does not claim VISION or user-story trace/i,
    ]);
    requireTerms(scenarioText(evalMatching(/List the canonical doc filenames but don't read them/i)), [
      /Does not treat script output alone/i,
      />500-line chunking rules/i,
      /only after reading, not after listing paths/i,
    ]);
  });
});
