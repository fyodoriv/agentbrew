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

const skillRoot = join(process.cwd(), "skill-plugins", "dev", "agentbrew-add-skill");
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

describe("agentbrew-add-skill skill contract", () => {
  it("pins the trigger scope and skill-author boundary", () => {
    requireTerms(skillText, [
      "Add a skill source to agentbrew so it deploys to all agents.",
      "Handles GitHub",
      "repos, local folders, and catalog installs.",
      'Use when the user says "add a',
      'skill", "install skill", or "I want all agents to have X".',
      "Don't use for",
      "creating skills from scratch (use Anthropic skill-creator or Superpowers writing-skills).",
      "Add a skill source so agentbrew tracks and syncs it to every agent.",
      "One",
      "registration = all agents get the skill on next sync.",
    ]);
  });

  it("requires catalog-first installs and recommended installs", () => {
    requireTerms(skillText, [
      "From Catalog (preferred — curated, security-screened)",
      "agentbrew catalog --skills",
      "browse available skills",
      "agentbrew install <skill-name>",
      "install one skill",
      "agentbrew install --recommended",
      "install all recommended at once",
      "After install, agentbrew automatically syncs to all agents.",
    ]);
  });

  it("documents GitHub source preview, selective install, and refresh tracking", () => {
    requireTerms(skillText, [
      "From GitHub Source",
      "agentbrew install user/repo",
      "add all skills in the repo",
      "agentbrew install user/repo --list",
      "preview available skills first",
      "agentbrew install user/repo --skill <name>",
      "install one specific skill",
      "directories with `SKILL.md` files",
      "~/.config/agentbrew/state.yaml",
      "agentbrew sync --pull",
    ]);
  });

  it("documents local folder installs with live symlink behavior and portability caveats", () => {
    requireTerms(skillText, [
      "From Local Folder",
      "agentbrew install /path/to/skills-folder",
      "folder containing skill dirs",
      "skills you're developing locally",
      "from a dotfiles repo",
      "Agentbrew symlinks from the source",
      "edits to the source are live immediately",
      "For team setups, prefer catalog or GitHub sources over local paths (portability)",
      "Do NOT use local paths in team/shared configs",
      "local paths don't resolve on other machines",
    ]);
  });

  it("pins verification and post-install invokability checks", () => {
    requireTerms(skillText, [
      "Verify & Sync",
      "agentbrew catalog --sources",
      "list all tracked sources with skill counts",
      "agentbrew status --verbose",
      "confirm skills deployed per agent",
      "agentbrew sync",
      "re-deploy if something looks off",
      "agentbrew sync --pull",
      "After Adding a Skill",
      "Run `agentbrew status --verbose`",
      "confirm the skill appears under each agent",
      "Check the skill is invokable",
      "~/.claude/skills/",
      "run `agentbrew sync` to force a re-deploy",
    ]);
  });

  it("requires valid skill shape, duplicate-source checks, and source review before install", () => {
    requireTerms(skillText, [
      "Every skill directory must contain a `SKILL.md` with valid frontmatter",
      "Skill names must be kebab-case matching the directory name",
      "Check `agentbrew catalog --sources` before adding",
      "avoid duplicate sources",
      "Never add a source you haven't reviewed",
      "skills run with full agent permissions",
      "Do NOT add unreviewed GitHub sources",
      "skills execute with full agent permissions",
      "run arbitrary commands",
      "Do NOT add duplicate sources",
      "duplicate sources cause skill conflicts and confuse agents",
      "Do NOT skip `agentbrew status --verbose`",
      "a skill that failed validation won't appear in agents and will silently not work",
    ]);
  });

  it("keeps eval metadata spec-valid and scenario-rich", () => {
    expect(evals.skill_name).toBe("agentbrew-add-skill");
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

  it("covers catalog install, GitHub preview, local development, and unreviewed-source refusal evals", () => {
    requireTerms(
      [
        evalMatching(/systematic-debugging|catalog skill/i).prompt,
        expectationText(evalMatching(/systematic-debugging|catalog skill/i)),
      ].join("\n"),
      [
        /agentbrew install systematic-debugging/i,
        /syncs.*all agents/i,
        /agentbrew status --verbose/i,
        /skill-creator|writing-skills/i,
      ],
    );

    requireTerms(
      [
        evalMatching(/vercel-labs\/skills|preview what's inside/i).prompt,
        expectationText(evalMatching(/vercel-labs\/skills|preview what's inside/i)),
      ].join("\n"),
      [/--list/i, /SKILL\.md/i, /instead of copying into agent directories/i, /status or sync verification/i],
    );

    requireTerms(
      [
        evalMatching(/local skills folder|develop it/i).prompt,
        expectationText(evalMatching(/local skills folder|develop it/i)),
      ].join("\n"),
      [/\/path\/to\/skills-folder/i, /symlinks from the source/i, /team\/shared configs/i, /duplicate sources/i],
    );

    requireTerms(
      [
        evalMatching(/unreviewed|do not review|without reviewing/i).prompt,
        expectationText(evalMatching(/unreviewed|do not review|without reviewing/i)),
      ].join("\n"),
      [/refuses|does not add/i, /agentbrew catalog --sources/i, /--list|review/i, /full agent permissions/i],
    );
  });
});
