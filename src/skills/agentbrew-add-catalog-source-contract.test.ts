import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evalMatcher, expectationText, requireTerms, type SkillEval } from "./skill-contract-test-helpers.js";

const skillRoot = join(process.cwd(), "skill-plugins", "dev", "agentbrew-add-catalog-source");
const skillText = readFileSync(join(skillRoot, "SKILL.md"), "utf-8");
const evals = JSON.parse(readFileSync(join(skillRoot, "evals", "evals.json"), "utf-8")) as {
  skill_name: string;
  evals: SkillEval[];
};
const evalMatching = evalMatcher(evals.evals);

describe("agentbrew-add-catalog-source skill contract", () => {
  it("pins shared catalog versus company plugin routing", () => {
    requireTerms(skillText, [
      "Decision tree — which catalog file?",
      "YES → the company plugin repo (agentbrew-plugin.yaml)",
      "released as a signed tag",
      "Visible only after `agentbrew plugin add <url>@<tag>`",
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
      "agentbrew plugin test <plugin-checkout>",
      "npx vitest run src/catalog/catalog.test.ts",
      "Verify local",
      "agentbrew catalog --json",
      "agentbrew plugin update <name> <new-signed-tag>",
      "If either count surprises you",
      "Stop and re-read",
    ]);
  });

  it("preserves whole-repo source guidance", () => {
    requireTerms(skillText, [
      "For a new whole-repo source",
      "repo_sources:",
      "source: owner/skills-registry",
      "auto_update defaults to true",
      "soft-updates it on a 30-min TTL",
      "company plugin's `skills/` dir",
      "Prefer this over per-skill",
      "whenever a repo has more than ~2 skills",
    ]);
  });

  it("keeps MCP and rule-specific catalog shapes distinct", () => {
    requireTerms(skillText, [
      "For a new MCP server",
      "under `mcp_servers:`",
      "env:",
      "setupLink:",
      "For company MCP servers, use the plugin's `mcp/servers.yaml`",
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
        /company-plugin|company plugin/i,
        /Refuses to add|not.*src\/catalog\.yaml/i,
        /setup instructions/i,
        /plugin validation/i,
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
      [/repo_sources/i, /company plugin/i, /prefer/i, /auto-registers|auto-update/i],
    );
  });
});
