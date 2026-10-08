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

const skillRoot = join(process.cwd(), "skill-plugins", "dev", "agentbrew-add-command");
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

function evalMatching(match: RegExp) {
  const found = evals.evals.find((skillEval) =>
    match.test([skillEval.prompt, skillEval.expected_output, expectationText(skillEval)].join("\n")),
  );
  expect(found, `missing eval matching ${match}`).toBeDefined();
  return found as SkillEval;
}

describe("agentbrew-add-command skill contract", () => {
  it("pins the canonical command source path and required frontmatter", () => {
    requireTerms(skillText, [
      "Create one canonical command file",
      "Write a Markdown file at `~/.config/agentbrew/commands/<name>.md`",
      "description: One-line description of what this command does",
      "Frontmatter fields:",
      "`description` — shown in each agent's command picker and agent UIs",
      "One canonical file per command",
      "Use kebab-case filenames",
      "Keep commands focused",
    ]);
  });

  it("documents Cursor turbo annotations and per-agent transformations", () => {
    requireTerms(skillText, [
      "Format Transformations Per Agent",
      "Cursor",
      "YAML frontmatter stripped",
      "`<!-- turbo -->` → `// turbo`",
      "above a step",
      "auto-runs",
      "without user confirmation prompt",
      "Claude Code | Kept as-is",
      "Gemini CLI  | Kept as-is",
    ]);
  });

  it("requires deploy and verification steps after command changes", () => {
    requireTerms(skillText, [
      "Deploy & Verify",
      "agentbrew sync",
      "agentbrew sync --only commands",
      "agentbrew commands list",
      "verify deployed commands",
      "Check that the command appears in the target agent's directory",
      "ls ~/.claude/commands/",
      "ls ~/.cursor/commands/",
    ]);
  });

  it("preserves edit and remove workflows through canonical state", () => {
    requireTerms(skillText, [
      "Edit the canonical file at `~/.config/agentbrew/commands/<name>.md`",
      "Never edit the per-agent copies",
      "agentbrew overwrites them on sync",
      "Remove a Command",
      "agentbrew remove <name>",
      "auto-detects command type",
      "removes everywhere",
      "re-sync to clean up per-agent files",
    ]);
  });

  it("keeps generated per-agent copy boundaries explicit", () => {
    requireTerms(skillText, [
      "Agent-specific commands go directly in the agent's directory",
      "agentbrew won't",
      "overwrite files it didn't create",
      "Do NOT edit per-agent copies",
      "`~/.claude/commands/`, `~/.cursor/commands/`, etc.",
      "agentbrew overwrites them on every sync",
      "losing your changes",
    ]);
  });

  it("blocks unsafe plaintext command content", () => {
    requireTerms(skillText, [
      "Do NOT put secrets or tokens in command files",
      "they are plaintext",
      "deployed to all agent directories",
    ]);
  });

  it("keeps eval metadata spec-valid and scenario-rich", () => {
    expect(evals.skill_name).toBe("agentbrew-add-command");
    expect(evals.evals).toHaveLength(4);
    expect(new Set(evals.evals.map((skillEval) => skillEval.id)).size).toBe(evals.evals.length);

    for (const skillEval of evals.evals) {
      expect(skillEval.prompt.trim(), `eval ${skillEval.id} prompt`).not.toBe("");
      expect(skillEval.expected_output.trim(), `eval ${skillEval.id} expected_output`).not.toBe("");
      expect(
        expectationText(skillEval).split("\n").filter(Boolean).length,
        `eval ${skillEval.id} expectations`,
      ).toBeGreaterThanOrEqual(4);
    }
  });

  it("covers creation, turbo, generated-copy correction, and secret-refusal eval scenarios", () => {
    requireTerms(
      [
        evalMatching(/release-checklist|all my agents/i).prompt,
        expectationText(evalMatching(/release-checklist|all my agents/i)),
      ].join("\n"),
      [/canonical Markdown file/i, /~\/\.config\/agentbrew\/commands/i, /description/i, /agentbrew commands list/i],
    );

    requireTerms(
      [
        evalMatching(/step two|auto-run without prompting/i).prompt,
        expectationText(evalMatching(/step two|auto-run without prompting/i)),
      ].join("\n"),
      [/<!-- turbo -->/i, /\/\/ turbo/i, /canonical command file/i, /commands-only sync|sync --only commands/i],
    );

    requireTerms(
      [
        evalMatching(/~\/\.claude\/commands\/deploy\.md|Gemini CLI gets the same change/i).prompt,
        expectationText(evalMatching(/~\/\.claude\/commands\/deploy\.md|Gemini CLI gets the same change/i)),
      ].join("\n"),
      [/generated per-agent output/i, /canonical .*commands/i, /sync --only commands/i, /overwrites per-agent copies/i],
    );

    requireTerms(
      [evalMatching(/token|secret|api key/i).prompt, expectationText(evalMatching(/token|secret|api key/i))].join("\n"),
      [
        /do not put secrets|refuses/i,
        /plaintext/i,
        /deployed to all agent directories/i,
        /safe alternative|environment/i,
      ],
    );
  });
});
