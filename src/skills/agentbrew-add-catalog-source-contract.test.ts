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

const skillRoot = join(process.cwd(), "skill-plugins", "dev", "agentbrew-add-catalog-source");
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

describe("agentbrew-add-catalog-source skill contract", () => {
  it("pins shared catalog versus team overlay routing", () => {
    requireTerms(skillText, [
      "Decision tree — which catalog file?",
      "YES → the team overlay's catalog-overlay.yaml",
      "Owner MUST be an approved team namespace",
      "Visible only after `agentbrew team set <overlay-url>`",
      "NO  → src/catalog.yaml",
      "Source is a public repo or truly generic built-in",
      "Never mix",
      "organization-specific entry in `src/catalog.yaml` violates AGENTS.md",
    ]);
  });

  it("preserves curator-not-host and no-vendoring boundaries", () => {
    requireTerms(skillText, [
      "curator, not a host",
      "catalog entries are pointers to source repos",
      "skill content never gets",
      "copied into agentbrew",
      "Confirm the `SKILL.md` lives in the source repo",
      "commit it upstream first",
      "Never vendor content into",
      "unless it documents agentbrew itself",
      "Do NOT copy SKILL.md files into agentbrew",
    ]);
  });

  it("requires catalog entry metadata and recommendation safeguards", () => {
    requireTerms(skillText, [
      "One-line description",
      "Start with an action verb",
      "Don't use for X",
      "recommended: false",
      "rationale: required ONLY when recommended: true",
      "Every entry must have a `description`",
      "recommended: true` requires a `rationale` field",
      "Check for duplicates by name before adding",
      /two\s+entries in the SAME file with the same name is a validator failure/,
    ]);
  });

  it("pins validation and local verification before readiness claims", () => {
    requireTerms(skillText, [
      "Run the validator(s)",
      "yaml-lint catalog-overlay.yaml",
      "npx vitest run src/catalog/catalog.test.ts",
      "Verify local",
      "agentbrew team unset && agentbrew catalog --json",
      "agentbrew team set <overlay-url>",
      "same-name overrides",
      "If either count surprises you",
      "Stop and re-read",
    ]);
  });

  it("preserves whole-repo source guidance for team overlays", () => {
    requireTerms(skillText, [
      "For a new whole-repo source (team overlay only)",
      "repo_sources:",
      "source: team-namespace/new-skills-registry",
      "auto_update defaults to true",
      "On `agentbrew team set <overlay-url>` the repo auto-registers",
      "On `agentbrew team unset` it's",
      "removed symmetrically",
      "Prefer this over per-skill entries",
      "whenever a repo has more than ~2 skills",
    ]);
  });

  it("keeps MCP and rule-specific catalog shapes distinct", () => {
    requireTerms(skillText, [
      "For a new MCP server",
      "under `mcp_servers:`",
      "env:",
      "setupLink:",
      "For overlay MCP servers add a `setup:` block",
      "For a new rule",
      "Rules go under `rules:`",
      "rules are the one exception",
      "with inline content",
    ]);
  });

  it("requires ticketed PRs and blocks invalid catalog publication shortcuts", () => {
    requireTerms(skillText, [
      "Every PR needs a project ticket in the title",
      "feat: catalog add",
      "PROJ-XXX",
      "Do NOT add an organization-specific entry to `src/catalog.yaml`",
      "Do NOT skip the validator",
      "Do NOT set `recommended: true` without a `rationale`",
    ]);
  });

  it("keeps eval metadata spec-valid and scenario-rich", () => {
    expect(evals.skill_name).toBe("agentbrew-add-catalog-source");
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

  it("covers public, internal, recommended, and repo-source eval scenarios", () => {
    requireTerms(
      [
        evalMatching(/public skill repo|code-review-helper/i).prompt,
        expectationText(evalMatching(/public skill repo|code-review-helper/i)),
      ].join("\n"),
      [/src\/catalog\.yaml/i, /does not vendor|not vendor/i, /don't-use guidance/i, /catalog validation/i],
    );

    requireTerms(
      [
        evalMatching(/internal portal-only MCP|company agents/i).prompt,
        expectationText(evalMatching(/internal portal-only MCP|company agents/i)),
      ].join("\n"),
      [
        /team-overlay|overlay/i,
        /Refuses to add|not.*src\/catalog\.yaml/i,
        /setup instructions/i,
        /overlay validation/i,
      ],
    );

    requireTerms(
      [evalMatching(/recommended by default/i).prompt, expectationText(evalMatching(/recommended by default/i))].join(
        "\n",
      ),
      [/broadly useful/i, /rationale/i, /duplicate names/i, /catalog validation/i],
    );

    requireTerms(
      [
        evalMatching(/repo_sources|whole repo|more than two skills/i).prompt,
        expectationText(evalMatching(/repo_sources|whole repo|more than two skills/i)),
      ].join("\n"),
      [/repo_sources/i, /team overlay/i, /prefer/i, /auto-registers|auto-update/i],
    );
  });
});
