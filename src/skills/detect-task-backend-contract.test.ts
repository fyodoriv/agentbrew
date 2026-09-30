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

const skillRoot = join(process.cwd(), "skill-plugins", "dev", "detect-task-backend");
const skillText = readFileSync(join(skillRoot, "SKILL.md"), "utf-8");
const evals = JSON.parse(readFileSync(join(skillRoot, "evals", "evals.json"), "utf-8")) as {
  skill_name: string;
  evals: SkillEval[];
};
const contractDocs = readFileSync(join(process.cwd(), "docs", "task-backend-contract.md"), "utf-8");
const resolverSource = readFileSync(join(process.cwd(), "src", "core", "task-backend.ts"), "utf-8");

function requireTerms(text: string, terms: Array<string | RegExp>) {
  for (const term of terms) {
    if (typeof term === "string") {
      expect(text, `missing term: ${term}`).toContain(term);
    } else {
      expect(text, `missing pattern: ${term}`).toMatch(term);
    }
  }
}

function rejectTerms(text: string, terms: Array<string | RegExp>) {
  for (const term of terms) {
    if (typeof term === "string") {
      expect(text, `forbidden term present: ${term}`).not.toContain(term);
    } else {
      expect(text, `forbidden pattern present: ${term}`).not.toMatch(term);
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

describe("detect-task-backend skill contract", () => {
  it("pins frontmatter, purpose, use case, implementation pattern, and config shape", () => {
    requireTerms(skillText, [
      "name: detect-task-backend",
      "Detect which task backend a repo uses (TASKS.md or GitHub Issues) using the agentbrew task backend contract.",
      "# Detect Task Backend",
      "Detects which task backend a repository uses by calling `resolveTaskBackend(repoPath)`.",
      "reference consumer demonstrating the task backend contract pattern",
      "## When to use",
      "Use this skill when you need to know whether a repo uses TASKS.md or GitHub Issues for task tracking.",
      "skills that branch their behavior based on the task backend",
      "filing tasks, listing tasks, picking next task",
      "## Implementation pattern",
      'import { resolveTaskBackend } from "agentbrew/src/core/task-backend";',
      "const descriptor = resolveTaskBackend(repoPath);",
      'if (descriptor.backend === "github-issues") {',
      "// Use GitHub Issues API",
      "const { repo, project } = descriptor;",
      "// Default to TASKS.md",
      "// ... read/write TASKS.md file",
      "## Configuration",
      "Repos declare their backend in `Agentfile.yaml` (preferred).",
      "If no Agentfile is present, `resolveTaskBackend(repoPath)` falls back to `.agents/tasks.config.yaml`.",
      "If neither file declares a backend, the descriptor defaults to `tasks-md`.",
      "# Default (tasks-md) — no config needed",
      "# GitHub Issues backend",
      "task_backend: github-issues",
      "repo: owner/repo",
      "project: 123",
      "Validation is part of the contract:",
      "`task_backend` must be exactly `tasks-md` or `github-issues`.",
      "`repo` must be an `owner/repo` string when `task_backend: github-issues`.",
      "`project` must be a positive integer when `task_backend: github-issues`.",
      "Malformed explicit GitHub Issues config is an actionable error; do not silently fall back to `TASKS.md`.",
      "A stale `TASKS.md` file does not override a `github-issues` descriptor.",
      "## See also",
      "[Task Backend Contract]",
      "[resolveTaskBackend API]",
    ]);
  });

  it("pins docs contract priority, validation, API descriptor, and port-adapter framing", () => {
    requireTerms(contractDocs, [
      "# Task Backend Contract",
      "The task backend contract allows agentbrew-managed repositories to declare where their work items live",
      "either in `TASKS.md` (the default) or in GitHub Issues/Projects",
      "skills and agents to branch on the backend without each one reinventing detection logic",
      "### Agentfile.yaml",
      "The preferred location is in the repo's `Agentfile.yaml`:",
      "task_backend: github-issues",
      "repo: owner/repo",
      "project: 123",
      "### .agents/tasks.config.yaml (fallback)",
      "If an Agentfile is not present, the resolver falls back to `.agents/tasks.config.yaml`:",
      '`task_backend`: Either `"tasks-md"` or `"github-issues"`. Default is `"tasks-md"`.',
      "`repo`: GitHub owner/repo string",
      'Required when `task_backend` is `"github-issues"`.',
      '`project`: GitHub Project number (integer). Required when `task_backend` is `"github-issues"`.',
      "## Resolution Logic",
      "1. **Agentfile.yaml** - if present, read `task_backend`, `repo`, and `project` fields.",
      "2. **.agents/tasks.config.yaml** - fallback if Agentfile is missing.",
      '3. **Default** - if neither file exists or the field is not set, return `"tasks-md"`.',
      "## Validation",
      "validates all inputs and throws actionable errors",
      '`task_backend` must be exactly `"tasks-md"` or `"github-issues"`.',
      '`repo` must be a string in `"owner/repo"` format.',
      "`project` must be a positive integer.",
      'When `task_backend` is `"github-issues"`, both `repo` and `project` are required.',
      "resolveTaskBackend(repoPath: string): TaskBackendDescriptor",
      'backend: "tasks-md" | "github-issues";',
      "repo?: `${string}/${string}`;  // only for github-issues",
      "project?: number;               // only for github-issues",
      "This contract follows the Hexagonal Architecture pattern (Ports & Adapters):",
      "**Port**: The `TaskBackendDescriptor` interface.",
      "**Adapters**: `tasks-md` and `github-issues` are two adapters that implement the same port.",
      "Skills and agents depend on the port (the contract), not the adapters.",
    ]);
    rejectTerms(contractDocs, [".tasksmd.json"]);
  });

  it("pins resolver source contract and validation behavior", () => {
    requireTerms(resolverSource, [
      'export type TaskBackend = "tasks-md" | "github-issues";',
      "export interface TaskBackendDescriptor",
      "backend: TaskBackend;",
      "repo?: `${string}/${string}`;",
      "project?: number;",
      "task_backend?: TaskBackend;",
      'const DEFAULT_BACKEND: TaskBackend = "tasks-md";',
      'if (value === "tasks-md" || value === "github-issues")',
      'throw new Error(`Invalid task_backend: ${JSON.stringify(value)}. Must be "tasks-md" or "github-issues".`);',
      "function validateRepo(value: unknown): `${string}/${string}`",
      "repo must be a string (owner/repo)",
      'repo must be in "owner/repo" format',
      "function validateProject(value: unknown): number",
      "project must be a positive integer",
      "function processConfig(config: AgentfileTaskBackendConfig, configSource: string): TaskBackendDescriptor",
      "if (config.task_backend === undefined)",
      "return { backend: DEFAULT_BACKEND };",
      'if (backend === "tasks-md")',
      "return { backend };",
      'github-issues backend requires both "repo" (owner/repo) and "project" (number)',
      "export function resolveTaskBackend(repoPath: string): TaskBackendDescriptor",
      "Reads from Agentfile.yaml (or .agents/tasks.config.yaml as fallback).",
      'Returns the backend descriptor with default fallback to "tasks-md".',
      "Read the Agentfile RAW rather than via loadAgentfile",
      'hide bad config as "missing"',
      "const agentfilePath = join(repoPath, name);",
      'return processConfig(raw as AgentfileTaskBackendConfig, "Agentfile");',
      'const tasksConfigPath = join(repoPath, ".agents", "tasks.config.yaml");',
      'return processConfig(config, ".agents/tasks.config.yaml");',
      "return { backend: DEFAULT_BACKEND };",
    ]);
    rejectTerms(resolverSource, [".tasksmd.json"]);
  });

  it("keeps eval metadata spec-valid, repairs stale contract drift, and adds pressure cases", () => {
    expect(evals.skill_name).toBe("detect-task-backend");
    expect(evals.evals).toHaveLength(8);
    expect(new Set(evals.evals.map((skillEval) => skillEval.id)).size).toBe(evals.evals.length);

    expect(evalById(1)).toMatchObject({
      prompt:
        "A skill needs to know whether this repo uses TASKS.md or GitHub Issues before filing work. What should it do?",
      expected_output: "Use resolveTaskBackend and branch behavior on tasks-md vs github-issues.",
    });
    requireTerms(expectationText(evalById(1)), [
      "Calls the shared resolveTaskBackend-style contract instead of ad hoc file probing only",
      "Handles the default tasks-md backend when no explicit config exists",
      "For github-issues, carries repo/project metadata forward to issue helpers",
      "Frames this as a reference consumer pattern for other task-aware skills",
    ]);

    expect(evalById(2)).toMatchObject({
      prompt: "Agentfile.yaml declares task_backend: github-issues with repo/project. How should next-task adapt?",
      expected_output: "Read backend descriptor and use issue APIs rather than editing TASKS.md.",
    });
    requireTerms(expectationText(evalById(2)), [
      "Reads Agentfile/backend metadata before choosing storage",
      "Avoids appending to TASKS.md when backend is github-issues",
      "Preserves TASKS.md behavior as the default fallback",
      "Surfaces missing repo/project config as an actionable configuration error",
    ]);

    expect(evalById(3)).toMatchObject({
      prompt: "A repo has no Agentfile.yaml and no task backend config. What backend should task-aware skills use?",
      expected_output: "Default to TASKS.md and continue with the standard file-based queue.",
    });
    requireTerms(expectationText(evalById(3)), [
      "Falls back to tasks-md when no backend declaration exists",
      "Does not require GitHub Issues setup for ordinary repos",
      "Explains that task-aware skills should branch on the descriptor rather than assume a backend",
      "Surfaces how a repo can opt into github-issues later",
    ]);

    expect(evalById(4)).toMatchObject({
      prompt:
        "I'm working in a repo and need to know whether to file tasks in TASKS.md or GitHub Issues. Detect the task backend for me.",
      expected_output:
        "A clear identification of the repo's task backend (TASKS.md or GitHub Issues) by using resolveTaskBackend(repoPath), with configuration details and instructions for filing tasks in the correct backend.",
    });
    requireTerms(expectationText(evalById(4)), [
      "Checks Agentfile.yaml/Agentfile.yml/Agentfile first for task_backend, repo, and project fields",
      "Falls back to .agents/tasks.config.yaml when no Agentfile is present",
      "Falls back to default tasks-md when neither config file declares a backend",
      "Returns a TaskBackendDescriptor with backend type ('tasks-md' or 'github-issues') and relevant GitHub Issues config (repo, project)",
      "Provides clear instructions on how to file tasks in the detected backend (e.g., issue APIs/tasks CLI for GitHub Issues, append to TASKS.md for default)",
    ]);
    rejectTerms(scenarioText(evalById(4)), [".tasksmd.json"]);

    expect(evalById(5)).toMatchObject({
      prompt:
        "Our team just switched from TASKS.md to GitHub Issues for task tracking. Verify that the configuration is correct.",
      expected_output:
        "Confirmation that the local task-backend configuration is valid for GitHub Issues, with actionable errors for missing or malformed repo/project fields and guidance for issue-tool access checks.",
    });
    requireTerms(expectationText(evalById(5)), [
      "Reads Agentfile.yaml or .agents/tasks.config.yaml and confirms task_backend is set to 'github-issues'",
      "Validates that repo and project fields are present and correctly formatted (owner/repo and positive integer project ID)",
      "Reports configuration errors for missing fields, invalid backend values, malformed repo strings, or invalid project numbers",
      "Does not silently fall back to TASKS.md when github-issues config is malformed",
      "Explains that live repository/project accessibility is checked by the GitHub Issues helper or tasks CLI after the descriptor is valid",
      "Suggests updating scripts or CI that reference TASKS.md directly to branch on resolveTaskBackend instead",
    ]);
    rejectTerms(scenarioText(evalById(5)), [/Attempts? to access the GitHub repository/i]);

    expect(evalById(6)).toMatchObject({
      prompt: "I'm writing a skill that needs to file tasks. How do I detect the backend and use the right API?",
      expected_output:
        "Example code demonstrating how to use resolveTaskBackend() to detect the backend and branch behavior accordingly, with concrete examples for both TASKS.md and GitHub Issues.",
    });
    requireTerms(expectationText(evalById(6)), [
      "Demonstrates importing resolveTaskBackend from agentbrew/src/core/task-backend",
      "Shows how to call resolveTaskBackend(repoPath) and handle the returned TaskBackendDescriptor",
      "Provides example code for the TASKS.md path (read/write TASKS.md file with proper formatting)",
      "Provides example code for the GitHub Issues path (use GitHub API or tasks CLI to create issues)",
      "Includes error handling for cases where the backend cannot be determined",
      "Shows how to access backend-specific config (repo, project ID for GitHub Issues)",
    ]);

    expect(evalById(7)).toMatchObject({
      prompt:
        "Agentfile.yaml says task_backend: github-issues, but this repo still has an old TASKS.md. I need to file a new follow-up. Can I just append to TASKS.md because it's already there?",
      expected_output:
        "A generated-backend safety answer that treats the resolver descriptor as authoritative and refuses to append to stale TASKS.md when github-issues is configured.",
    });
    requireTerms(expectationText(evalById(7)), [
      "Calls resolveTaskBackend(repoPath) and treats the returned descriptor as the source of truth over the mere presence of TASKS.md",
      "Refuses to append a new task to TASKS.md when descriptor.backend is 'github-issues'",
      "Carries descriptor.repo and descriptor.project into the GitHub Issues helper or tasks CLI path",
      "Mentions stale TASKS.md may exist as history or migration residue and is not evidence of the active backend",
      "Falls back to TASKS.md only when the descriptor backend is tasks-md",
    ]);

    expect(evalById(8)).toMatchObject({
      prompt:
        "A repo has task_backend: github-issues but no project number, and another repo has no Agentfile or .agents/tasks.config.yaml at all. Should both just default to TASKS.md?",
      expected_output:
        "A boundary answer that distinguishes malformed explicit GitHub Issues config from absent config: malformed explicit config is an actionable error, absent config defaults to tasks-md.",
    });
    requireTerms(expectationText(evalById(8)), [
      "Reports missing project/repo for explicit github-issues config as an actionable configuration error",
      "Does not silently default malformed github-issues config to TASKS.md",
      "Validates task_backend must be exactly 'tasks-md' or 'github-issues'",
      "Validates repo must be owner/repo and project must be a positive integer",
      "Defaults to tasks-md only when no Agentfile or .agents/tasks.config.yaml declares a backend",
    ]);

    for (const skillEval of evals.evals) {
      expect(skillEval.prompt.trim(), `eval ${skillEval.id} prompt`).not.toBe("");
      expect(skillEval.expected_output.trim(), `eval ${skillEval.id} expected_output`).not.toBe("");
      expect(
        expectationText(skillEval).split("\n").filter(Boolean).length,
        `eval ${skillEval.id} expectations`,
      ).toBeGreaterThanOrEqual(4);
    }
  });

  it("covers resolver usage, GitHub Issues branching, default fallback, config detection, validation, stale TASKS.md safety, and malformed-vs-absent config", () => {
    requireTerms(scenarioText(evalMatching(/whether this repo uses TASKS\.md or GitHub Issues before filing work/i)), [
      /resolveTaskBackend-style contract instead of ad hoc file probing/i,
      /default tasks-md backend/i,
      /repo\/project metadata forward to issue helpers/i,
      /reference consumer pattern/i,
    ]);

    requireTerms(scenarioText(evalMatching(/Agentfile\.yaml declares task_backend: github-issues/i)), [
      /backend descriptor/i,
      /issue APIs rather than editing TASKS\.md/i,
      /Avoids appending to TASKS\.md/i,
      /default fallback/i,
      /missing repo\/project config as an actionable configuration error/i,
    ]);

    requireTerms(scenarioText(evalMatching(/no Agentfile\.yaml and no task backend config/i)), [
      /Default to TASKS\.md/i,
      /Falls back to tasks-md/i,
      /Does not require GitHub Issues setup/i,
      /branch on the descriptor rather than assume a backend/i,
      /opt into github-issues later/i,
    ]);

    requireTerms(scenarioText(evalMatching(/need to know whether to file tasks in TASKS\.md or GitHub Issues/i)), [
      /resolveTaskBackend\(repoPath\)/i,
      /Agentfile\.yaml\/Agentfile\.yml\/Agentfile first/i,
      /\.agents\/tasks\.config\.yaml/i,
      /default tasks-md/i,
      /TaskBackendDescriptor/i,
      /issue APIs\/tasks CLI.*append to TASKS\.md/is,
    ]);

    requireTerms(scenarioText(evalMatching(/switched from TASKS\.md to GitHub Issues/i)), [
      /local task-backend configuration is valid/i,
      /Agentfile\.yaml or \.agents\/tasks\.config\.yaml/i,
      /repo and project fields.*owner\/repo and positive integer project ID/is,
      /missing fields, invalid backend values, malformed repo strings, or invalid project numbers/i,
      /Does not silently fall back to TASKS\.md/i,
      /live repository\/project accessibility is checked by the GitHub Issues helper or tasks CLI/i,
      /branch on resolveTaskBackend/i,
    ]);

    requireTerms(scenarioText(evalMatching(/writing a skill that needs to file tasks/i)), [
      /importing resolveTaskBackend from agentbrew\/src\/core\/task-backend/i,
      /resolveTaskBackend\(repoPath\).*TaskBackendDescriptor/is,
      /TASKS\.md path.*read\/write TASKS\.md/is,
      /GitHub Issues path.*GitHub API or tasks CLI/is,
      /backend-specific config \(repo, project ID/i,
    ]);

    requireTerms(scenarioText(evalMatching(/still has an old TASKS\.md/i)), [
      /descriptor as the source of truth over the mere presence of TASKS\.md/i,
      /Refuses to append a new task to TASKS\.md/i,
      /descriptor\.repo and descriptor\.project/i,
      /stale TASKS\.md may exist as history or migration residue/i,
      /Falls back to TASKS\.md only when the descriptor backend is tasks-md/i,
    ]);

    requireTerms(scenarioText(evalMatching(/github-issues but no project number/i)), [
      /malformed explicit GitHub Issues config.*actionable error/is,
      /absent config defaults to tasks-md/i,
      /Reports missing project\/repo/i,
      /Does not silently default malformed github-issues config to TASKS\.md/i,
      /task_backend must be exactly 'tasks-md' or 'github-issues'/i,
      /repo must be owner\/repo and project must be a positive integer/i,
      /no Agentfile or \.agents\/tasks\.config\.yaml/i,
    ]);

    rejectTerms(JSON.stringify(evals, null, 2), [".tasksmd.json", /Attempts? to access the GitHub repository/i]);
  });
});
