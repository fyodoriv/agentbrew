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

const skillRoot = join(process.cwd(), "skill-plugins", "dev", "competitor-spot-check");
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

describe("competitor-spot-check skill contract", () => {
  it("pins frontmatter, purpose, and wrong-tool routing", () => {
    requireTerms(skillText, [
      "name: competitor-spot-check",
      /Search the current repo's `competitors\/` and `docs\/competition\/` directories for prior art on a proposed feature/,
      "before filling the `Competitor prior art` field in a PR body or before proposing the feature at all.",
      "Use when about to propose a feature",
      "when filling a PR's `## Vision trace` block",
      "when reviewing a PR that lacks a citation",
      'when a user mentions "have competitors shipped this."',
      "Don't use for general competitive analysis (that's `strategic-review`)",
      "adding a new competitor to the corpus (that's `companion-competitor-watch`).",
      "# competitor-spot-check",
      "The companion to the `pr-vision-trace` CI gate.",
      "surfaces prior art so the agent / human filling the PR's `Competitor prior art` field has something concrete to cite.",
      "## Why this exists",
      "The `pr-vision-trace` gate (CI-enforced in adopting repos)",
      "requires every PR body to include a `Competitor prior art` line.",
      "Without this skill, the agent fills that line with `N/A — didn't check`, which defeats the point.",
      "This skill is the deterministic search step that produces a real citation.",
    ]);
  });

  it("pins invocation triggers and larger-system relationship", () => {
    requireTerms(skillText, [
      "It pairs with `companion-competitor-watch`",
      "and `load-project-context`",
      "Together: load competitors on session start → check prior art before proposing → cite the result in the PR body → CI verifies the citation exists.",
      "## When to invoke",
      "**Yes:**",
      "About to fill a PR's `## Vision trace` block's `Competitor prior art:` field",
      "Proposing a feature and want to check whether a competitor already ships it",
      "Reviewing someone's PR that has `N/A — didn't check` on the competitor line",
      'User asks "have competitors shipped X" / "is there prior art for Y"',
      "**No:**",
      'General "what do competitors do" questions — use `strategic-review` for that',
      "Adding a new competitor doc — use `companion-competitor-watch`",
      "Reading the existing corpus end-to-end — just `cat docs/competition/*.md`",
      "## Relationship to the larger system",
      "The `load-project-context` rule + Claude Code SessionStart hook auto-load the competitive corpus into context at session start.",
      "`companion-competitor-watch` keeps the corpus refreshed",
      "`competitor-spot-check` (this skill) is the query layer over the loaded corpus.",
      "`pr-vision-trace` CI gate enforces that every PR body cites the result.",
      'The four together turn "I should check competitors" into "the CI fails if I didn\'t."',
    ]);
  });

  it("pins script invocation, canonical corpus locations, search behavior, result shapes, and exit code", () => {
    requireTerms(skillText, [
      "## How to invoke",
      "Run from any repo root:",
      'bash ~/.config/agentbrew/scripts/competitor-spot-check.sh "<feature description>"',
      "The script:",
      "Looks for canonical competitive corpus locations in the current repo:",
      "`competitors/` (root) — minsky pattern",
      "`docs/competitors/` — alt pattern",
      "`docs/competition/` — agentbrew + others",
      "`docs/competition.md` (single file) — variant",
      "`COMPETITORS.md` (root single file) — variant",
      "Greps each found location (case-insensitive)",
      "feature description's keywords (split on whitespace, ignore stopwords).",
      "For each match: prints `[<competitor-name>] <line of context> (<path>:<line-no>)`.",
      "If zero matches: prints `no prior art found in <N> competitor files scanned — safe to propose, but note in the PR body that you scanned and found nothing`.",
      'If many matches: caps output at 20 and prints "+N more matches — refine search keywords".',
      "Exit code 0 always (it's a research tool, not a gate).",
    ]);
  });

  it("pins PR-body usage for found and no-match results", () => {
    requireTerms(skillText, [
      "## How to use the result",
      "**If prior art found:** quote it in the PR body's `Competitor prior art` line:",
      "- **Competitor prior art**: skills-cli ships `skills add --from <url>`",
      "docs/competition/vercel-skills-cli-vs-agentbrew.md:142",
      "we delegate via `agentbrew install --from <url>` rather than reimplement",
      "**If no prior art found:** still note the scan in the PR body:",
      "- **Competitor prior art**: N/A — scanned 4 competitor docs",
      "no comparable feature",
      "The CI gate accepts both forms (≥3 chars of substantive text)",
      "the difference is honesty about whether the check happened.",
    ]);
  });

  it("pins edge cases for no corpus, stopwords, and huge docs", () => {
    requireTerms(skillText, [
      "## Edge cases",
      "**Repo has no competitive corpus**",
      "the script reports `no competitive corpus in this repo`.",
      "The PR template's competitor line should then say `N/A — repo has no competitive corpus (deployment manifest / pure tooling)`.",
      "That's a legitimate opt-out.",
      "**Feature description has only stopwords**",
      "the script asks for more specific terms.",
      "**Competitor docs are huge**",
      "the script greps with `-l` to surface file matches",
      "then with `-n` to get line context.",
      "Hit count is meaningful even when content is too long to print.",
    ]);
  });

  it("keeps eval metadata spec-valid, preserves existing scenarios, and adds pressure cases", () => {
    expect(evals.skill_name).toBe("competitor-spot-check");
    expect(evals.evals).toHaveLength(8);
    expect(new Set(evals.evals.map((skillEval) => skillEval.id)).size).toBe(evals.evals.length);

    expect(evalById(1)).toMatchObject({
      prompt:
        "I am filling the PR template for a feature that adds team-scoped skill presets. Find competitor prior art for the `Competitor prior art` line.",
    });
    requireTerms(expectationText(evalById(1)), [
      "Searches the repo competitive corpus locations such as competitors/, docs/competitors/, docs/competition/, docs/competition.md, and COMPETITORS.md",
      "Uses focused feature keywords instead of generic terms that would overmatch the corpus",
      "Quotes file path and line number when prior art is found",
      "If no prior art is found, states how many competitor docs were scanned and says so in the PR body rather than claiming N/A blindly",
      "Does not expand into a general competitive analysis or add new competitor docs",
    ]);

    expect(evalById(2)).toMatchObject({
      prompt: "A PR review has `Competitor prior art: N/A — did not check`. What should I do before approving it?",
    });
    requireTerms(expectationText(evalById(2)), [
      "Treats an unchecked competitor line as insufficient for the pr-vision-trace workflow",
      "Runs the spot-check against the current repo corpus before suggesting review approval",
      "Returns an actionable replacement line for the PR body",
      "Uses existing competitor docs rather than reading the entire corpus manually by default",
      "Mentions the edge case when the repo has no competitive corpus",
    ]);

    expect(evalById(3)).toMatchObject({
      prompt: "Have competitors shipped anything like our proposed inline MCP dashboard?",
    });
    requireTerms(expectationText(evalById(3)), [
      "Distinguishes this spot check from strategic-review or companion-competitor-watch",
      "Searches only the existing competitive corpus for relevant feature keywords",
      "Caps or summarizes excessive matches and recommends refining keywords if needed",
      "Reports no-match results honestly instead of inventing competitor claims",
      "Provides a citation-ready answer suitable for a Vision trace block",
    ]);

    expect(evalById(4)).toMatchObject({
      prompt:
        "You're filling a PR's `## Vision trace` block and need to cite competitor prior art for a 'skill installation from GitHub URL' feature. Run the spot-check and explain what you find.",
    });
    requireTerms(expectationText(evalById(4)), [
      "Runs bash ~/.config/agentbrew/scripts/competitor-spot-check.sh 'skill installation from GitHub URL'",
      "Searches canonical corpus locations: competitors/, docs/competitors/, docs/competition/, docs/competition.md, COMPETITORS.md",
      "Greps each location case-insensitively for keywords (split on whitespace, ignoring stopwords)",
      "Returns matches in format: [<competitor-name>] <line of context> (<path>:<line-no>)",
      "If matches found: quotes them in the PR body's Competitor prior art line with exact citation",
      "If no matches: notes the scan in the PR body: 'N/A — scanned N competitor docs, no comparable feature'",
    ]);

    expect(evalById(5)).toMatchObject({
      prompt:
        "The spot-check found 47 matches for 'agent skills' across competitor docs. The output is too long. What does the script do, and how do you use the result?",
    });
    requireTerms(expectationText(evalById(5)), [
      "Script caps output at 20 matches and prints '+N more matches — refine search keywords'",
      "Recognizes that 'agent skills' is too broad and needs more specific keywords",
      "Refines the search to more specific terms (e.g., 'skill installation from GitHub', 'skill discovery')",
      "Re-runs the spot-check with refined keywords to get a manageable result set",
      "Cites the most relevant matches in the PR body, not all 47",
    ]);

    expect(evalById(6)).toMatchObject({
      prompt:
        "The repo has no docs/competitors/ or docs/competition/ directory. What does the spot-check report, and what should the PR body say?",
    });
    requireTerms(expectationText(evalById(6)), [
      "Script reports: 'no competitive corpus in this repo'",
      "Recognizes this as a legitimate opt-out (deployment manifest, pure tooling, no external competitors)",
      "PR body Competitor prior art line says: 'N/A — repo has no competitive corpus (deployment manifest / pure tooling)'",
      "Does not force a competitor search when the repo genuinely has no competitive corpus",
      "Acknowledges that some repos are not competitive products",
    ]);

    expect(evalById(7)).toMatchObject({
      prompt: "Check competitor prior art for 'do it' / 'make this work' and fill the PR line anyway.",
      expected_output:
        "A specificity request that refuses to treat an all-stopword or underspecified query as a valid no-prior-art scan.",
    });
    requireTerms(expectationText(evalById(7)), [
      "Detects that the feature description has only stopwords or too few specific keywords",
      "Asks for more specific feature terms before claiming a scan result",
      "Does not fabricate competitor citations from an invalid query",
      "Does not write `N/A — scanned corpus` when no meaningful search was performed",
      "Suggests concrete example terms that would make the spot-check useful",
    ]);

    expect(evalById(8)).toMatchObject({
      prompt:
        "Use the competitor spot-check to refresh our competitor docs, add a new competitor entry, and recommend whether we should pivot before opening this PR.",
      expected_output:
        "A scope correction that keeps spot-check read-only and routes corpus refresh or strategy work to the right skills.",
    });
    requireTerms(expectationText(evalById(8)), [
      "Explains that competitor-spot-check only queries the existing corpus for PR-body prior art",
      "Routes new or refreshed competitor documentation to `companion-competitor-watch`",
      "Routes broad strategic or pivot analysis to `strategic-review`",
      "Does not edit competitor docs, add new competitor entries, or rewrite VISION.md",
      "If still filling a PR line, runs or describes the narrow spot-check and returns only citation-ready prior-art evidence",
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

  it("covers PR citation, unchecked N/A, narrow prior-art search, script invocation, high-match handling, no corpus, stopword pressure, and wrong-tool pressure", () => {
    requireTerms(scenarioText(evalMatching(/team-scoped skill presets/i)), [
      /competitive corpus locations such as competitors\/, docs\/competitors\/, docs\/competition\//i,
      /focused feature keywords/i,
      /file path and line number/i,
      /how many competitor docs were scanned/i,
      /Does not expand into a general competitive analysis or add new competitor docs/i,
    ]);

    requireTerms(scenarioText(evalMatching(/N\/A — did not check/i)), [
      /unchecked competitor line as insufficient/i,
      /current repo corpus before suggesting review approval/i,
      /actionable replacement line/i,
      /existing competitor docs/i,
      /no competitive corpus/i,
    ]);

    requireTerms(scenarioText(evalMatching(/inline MCP dashboard/i)), [
      /strategic-review or companion-competitor-watch/i,
      /existing competitive corpus/i,
      /excessive matches.*refining keywords/i,
      /no-match results honestly/i,
      /citation-ready answer suitable for a Vision trace block/i,
    ]);

    requireTerms(scenarioText(evalMatching(/skill installation from GitHub URL/i)), [
      /competitor-spot-check\.sh 'skill installation from GitHub URL'/i,
      /competitors\/.*docs\/competitors\/.*docs\/competition\/.*docs\/competition\.md.*COMPETITORS\.md/i,
      /case-insensitively.*split on whitespace.*ignoring stopwords/i,
      /\[<competitor-name>\] <line of context> \(<path>:<line-no>\)/i,
      /exact citation/i,
      /N\/A — scanned N competitor docs/i,
    ]);

    requireTerms(scenarioText(evalMatching(/47 matches for 'agent skills'/i)), [
      /caps output at 20 matches/i,
      /\+N more matches — refine search keywords/i,
      /too broad/i,
      /Re-runs the spot-check with refined keywords/i,
      /Cites the most relevant matches/i,
    ]);

    requireTerms(scenarioText(evalMatching(/no docs\/competitors\/ or docs\/competition\//i)), [
      /no competitive corpus in this repo/i,
      /legitimate opt-out/i,
      /N\/A — repo has no competitive corpus/i,
      /Does not force a competitor search/i,
      /not competitive products/i,
    ]);

    requireTerms(scenarioText(evalMatching(/Check competitor prior art.*make this work/i)), [
      /only stopwords|too few specific keywords/i,
      /Asks for more specific feature terms/i,
      /Does not fabricate competitor citations/i,
      /Does not write `N\/A — scanned corpus`/i,
      /example terms/i,
    ]);

    requireTerms(scenarioText(evalMatching(/refresh our competitor docs.*recommend whether we should pivot/i)), [
      /only queries the existing corpus/i,
      /companion-competitor-watch/i,
      /strategic-review/i,
      /Does not edit competitor docs, add new competitor entries, or rewrite VISION\.md/i,
      /citation-ready prior-art evidence/i,
    ]);
  });
});
