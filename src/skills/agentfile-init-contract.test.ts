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

const skillRoot = join(process.cwd(), "skill-plugins", "dev", "agentfile-init");
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

describe("agentfile-init skill contract", () => {
  it("pins trigger scope, source-of-truth purpose, and single-MCP boundary", () => {
    requireTerms(skillText, [
      "Create an Agentfile.yaml for any project",
      "detects the tech stack",
      "suggests MCP servers",
      "from the catalog",
      "writes a ready-to-sync config",
      'Use when the user says "set up\n  agentbrew", "create agentfile", "add agentbrew to this project"',
      "starts working in\n  a repo that has no Agentfile",
      "Don't use for adding a single MCP server (use agentbrew-add-mcp).",
      "Create an `Agentfile.yaml` at the project root",
      "declares MCP servers, skills, and sources for the project",
      "run `agentbrew sync` to deploy to all agents",
    ]);
  });

  it("requires non-destructive existing-Agentfile inspection before writing", () => {
    requireTerms(skillText, [
      "Check if Agentfile already exists",
      "ls Agentfile.yaml Agentfile.yml Agentfile 2>/dev/null",
      "If one exists, read it",
      "ask the user if they want to update it rather than overwrite",
    ]);
  });

  it("pins stack-detection inputs and interpreted project signals", () => {
    requireTerms(skillText, [
      "Detect the project stack",
      "Read the project root to identify the tech stack",
      "ls package.json Cargo.toml pyproject.toml go.mod requirements.txt Gemfile build.gradle pom.xml 2>/dev/null",
      "cat package.json 2>/dev/null | head -30",
      "ls -d .github/ .gitlab-ci.yml Jenkinsfile 2>/dev/null",
      "ls TASKS.md 2>/dev/null",
      "Language/framework",
      "Node.js, Python, Rust, Go, Ruby, Java",
      "CI system",
      "GitHub Actions, GitLab CI, Jenkins",
      "Database",
      "Postgres, MySQL, MongoDB",
      "Error tracking",
      "Sentry, Datadog, Splunk",
      "Task management",
      "TASKS.md present?",
      "Agent guide",
      "AGENTS.md present?",
      "read it before writing repo-local",
      "if no, note that the project needs one",
    ]);
  });

  it("keeps catalog selection conditional and context7-first", () => {
    requireTerms(skillText, [
      "Select MCP servers from catalog",
      "Always include `context7` (live docs).",
      "Any project | `context7` | Live docs for any library",
      "TASKS.md present | `tasks-mcp` | Programmatic task management",
      "GitHub repo | `github` | PR/issue management",
      "Postgres in deps/env | `postgres` | Database queries",
      "Sentry in deps/env | `sentry` | Error tracking",
      "Splunk references | `splunk` | Log queries",
      "Jenkins CI | `jenkins` | Build management",
      "Notion references | `notion` | Doc access",
      "Need web search | `brave-search` | Research",
      "Browser testing needed | `playwright` | UI automation",
    ]);
  });

  it("pins Agentfile structure, shorthand rules, and example patterns", () => {
    requireTerms(skillText, [
      "Create `Agentfile.yaml` with this structure:",
      "# Agentfile — project agent configuration",
      "# Run `agentbrew sync` to deploy to all agents.",
      "mcp:",
      "  - context7",
      "  - tasks-mcp       # only if TASKS.md exists",
      "  - github           # only if GitHub repo",
      "Use catalog shorthand names (just the string) for catalog servers",
      "Only include servers the project actually needs",
      "don't over-provision",
      "Add a comment explaining non-obvious choices",
      "Put `context7` first",
      "every project benefits from live docs",
      "Catalog shorthand — just the name, agentbrew resolves the command",
      "Full spec for custom/non-catalog servers",
      'API_KEY: "${MY_API_KEY}"',
      "Skills to install from catalog",
      "Skill sources (GitHub repos or local paths)",
      "Shared rules (inline or file path)",
      "Install all recommended items",
      "Minimal (any project):",
      "Node.js web app:",
      "Python data service with Postgres:",
      "Enterprise project with full tooling:",
    ]);
  });

  it("requires dry-run review, AGENTS.md lifecycle guidance, and focused commit scope", () => {
    requireTerms(skillText, [
      "Sync and verify",
      "agentbrew sync --dry-run",
      "Review the dry-run output with the user.",
      "If it looks good:",
      "agentbrew sync",
      "Update the agent guide when needed",
      "If the repo has an `AGENTS.md`",
      "make sure it mentions the Agentfile lifecycle",
      "what the root Agentfile declares",
      "when to run `agentbrew sync`",
      "how it\ndiffers from generated per-agent config",
      "If the repo lacks an agent guide and is\nan agent-tool project",
      "docs/agent-guide-baseline.md",
      "Do not copy the checklist verbatim into every repo.",
      "write repo-specific facts",
      "git add Agentfile.yaml",
      'git commit -m "feat: add Agentfile for agentbrew project config"',
    ]);
  });

  it("keeps eval metadata spec-valid and scenario-rich", () => {
    expect(evals.skill_name).toBe("agentfile-init");
    expect(evals.evals).toHaveLength(5);
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

  it("covers new setup, existing updates, enterprise guides, over-provisioning, and no-dry-run evals", () => {
    requireTerms(
      [
        evalMatching(/Node\.js repo|TASKS\.md|GitHub Actions/i).prompt,
        expectationText(evalMatching(/Node\.js repo|TASKS\.md|GitHub Actions/i)),
      ].join("\n"),
      [/Agentfile.*exists/i, /Node\.js stack/i, /context7.*first/i, /sync --dry-run/i],
    );

    requireTerms(
      [
        evalMatching(/already an `?Agentfile\.yaml`?|Python service with Postgres/i).prompt,
        expectationText(evalMatching(/already an `?Agentfile\.yaml`?|Python service with Postgres/i)),
      ].join("\n"),
      [/reads the existing Agentfile/i, /Python and Postgres/i, /preserving existing entries/i, /dry-run.*sync/i],
    );

    requireTerms(
      [
        evalMatching(/enterprise repo|Jenkins|Splunk|no AGENTS\.md/i).prompt,
        expectationText(evalMatching(/enterprise repo|Jenkins|Splunk|no AGENTS\.md/i)),
      ].join("\n"),
      [/Jenkins, Splunk, and browser-testing/i, /without over-provisioning/i, /agentbrew baseline/i, /dry-run/i],
    );

    requireTerms(
      [
        evalMatching(/every MCP server|all MCP servers/i).prompt,
        expectationText(evalMatching(/every MCP server|all MCP servers/i)),
      ].join("\n"),
      [/refuses|does not add/i, /only include servers.*needs|don't over-provision/i, /detects.*stack/i, /context7/i],
    );

    requireTerms(
      [
        evalMatching(/skip.*dry-run|run sync now|no dry-run/i).prompt,
        expectationText(evalMatching(/skip.*dry-run|run sync now|no dry-run/i)),
      ].join("\n"),
      [
        /agentbrew sync --dry-run/i,
        /before.*agentbrew sync/i,
        /reviews?.*output/i,
        /does not run.*real.*sync|refuses/i,
      ],
    );
  });
});
