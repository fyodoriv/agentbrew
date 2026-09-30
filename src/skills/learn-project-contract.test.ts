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

const skillRoot = join(process.cwd(), "skill-plugins", "dev", "learn-project");
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

describe("learn-project skill contract", () => {
  it("pins frontmatter as a single stage-aware orchestrator over six source types", () => {
    requireTerms(skillText, [
      "name: learn-project",
      "Single entrypoint that teaches you a software project",
      "Google Docs incl. all tabs (Drive MCP)",
      "Jira issues/epics/initiatives (Jira MCP)",
      "Stage-aware: resumes wherever prep left off",
      "allowed-tools: Read, Write, Edit, Glob, Grep, Bash, WebFetch",
    ]);
  });

  it("pins the orchestration pipeline and stable resumable staging root", () => {
    requireTerms(skillText, [
      "ensure tools → detect stage → intake → gather sources → stage →",
      "teach (/tutor-setup) → quiz (/tutor)",
      "you drive them, you do not reimplement them",
      "**Default staging root:** `./.learn-project/`",
    ]);
  });

  it("pins prerequisite auto-install without faking the vault", () => {
    requireTerms(skillText, [
      "agentbrew install tutor-setup --from bevibing/tutor-skills",
      "agentbrew install tutor --from bevibing/tutor-skills",
      "fall back to `npx skills add bevibing/tutor-skills`",
      "do not fake the vault",
    ]);
  });

  it("pins stage detection so re-invocation resumes instead of restarting", () => {
    requireTerms(skillText, [
      "Detect the current stage (resume, don't restart)",
      "A StudyVault already exists",
      "**Phase 6** — go straight to /tutor",
      "`<root>/manifest.json` exists but no StudyVault",
      "Nothing staged yet",
    ]);
  });

  it("pins the six-source intake table and infer-then-ask discipline", () => {
    requireTerms(skillText, [
      "Intake (ask only for what's missing)",
      "Never invent private repo names, Google Doc IDs, or Jira keys",
      "Local folder/repo",
      "Remote enterprise repo",
      "Google Doc",
      "Jira issue/epic/initiative",
      "Loose files",
      "Web pages",
    ]);
  });

  it("pins the enterprise-repo shorthand caveat and full-URL requirement", () => {
    requireTerms(skillText, [
      "an\n  `owner/repo` shorthand resolves to **public github.com**",
      "for `ghe.example.com`",
      "pass the **full git URL** to `--repo`",
    ]);
  });

  it("pins all-tabs Google Doc extraction and Jira parent/child traversal", () => {
    requireTerms(skillText, [
      "`list_document_tabs`, then\n  `read_document`",
      "for **each tab**",
      "never stage only the currently-open tab",
      '`jira_search_issues` with `issueKeys:["KEY"]`',
      '`parentKeys:["KEY"]` to pull child issues',
    ]);
  });

  it("pins PR-as-document handling for RFC-style PRs", () => {
    requireTerms(skillText, [
      "get_pull_request",
      "get_pull_request_files",
      "When the PR *is* the document",
      "pull the changed files' **content**, not just metadata",
    ]);
  });

  it("pins the deterministic aggregator handoff and manifest read", () => {
    requireTerms(skillText, [
      "Run the aggregator (deterministic)",
      "npm run stage-learn-sources -- ./.learn-project",
      "The deterministic aggregator does NOT call MCPs",
      "Read `manifest.json` → note `tutorSetupMode`, `tutorSetupCwd`, and **`freshness`**",
      "re-stages only changed sources",
    ]);
  });

  it("pins the cite-or-refuse grounding addendum and tutor-setup mode mapping", () => {
    requireTerms(skillText, [
      "Grounding addendum (cite-or-refuse)",
      "Every factual claim in a note must cite a staged path",
      "mark it `source: unverified` or omit it",
      "| `codebase` | Codebase Mode (single repo) |",
      "| `document` | Document Mode (docs/files/web/context only) |",
    ]);
  });

  it("pins the quiz-quality addendum: meaning over trivia, self-contained, grounded", () => {
    requireTerms(skillText, [
      "Quiz-quality addendum (test understanding, not trivia)",
      "**Test meaning, not memorization.**",
      'a name for a list ("what are the three X called")',
      "a spec/requirement ID",
      "**Be self-contained and unambiguous.**",
      "**Phrase it in clean, natural English.**",
      "**Order major-first.**",
      "the big-picture, highest-importance\n  concepts",
      "question the vault can't answer is a bad question, not a hard one",
      "If the user says a question is bad",
      "regenerate a meaning-based, cleanly-worded version, and prefer\napplication/analysis over recall",
    ]);
  });

  it("pins random correct-answer positioning (no positional pattern)", () => {
    requireTerms(skillText, [
      "**Randomize the correct option's position.**",
      "place the correct answer in\n  a genuinely random slot",
      "the correct answer is\n  always the first option",
      "re-check the distribution before presenting",
    ]);
  });

  it("pins an 'I don't know — teach me' option on every question", () => {
    requireTerms(skillText, [
      '**Always offer "I don\'t know — teach me."**',
      "surfaces a blind spot instead of guessing",
      "treat it as a not-known signal (not a wrong guess): teach the concept concisely",
      "mark it for review in the tracker",
    ]);
  });

  it("pins teach-before-quiz: a concise learning brief precedes /tutor", () => {
    requireTerms(skillText, [
      "Present a concise learning brief (teach before testing)",
      'This skill is "teach me, **then** quiz me" — never quiz cold.',
      "**before** starting /tutor, present the user a **refined, concise learning brief**",
      "The vault is the durable artifact; this brief is the fast on-ramp that makes the quiz fair.",
      "- [ ] Phase 5b: concise learning brief presented (teach before testing)",
    ]);
  });

  it("pins the verification gate: answer-from-vault-only before quizzing", () => {
    requireTerms(skillText, [
      "### Verification gate (answer from vault only)",
      "Chain-of-Verification / RAGAS-faithfulness pattern",
      "**Question verification.**",
      "using **only** the vault notes",
      "**discard** the\n   question and regenerate",
      "**Claim verification.**",
      "mark it `source: unverified` or omit",
      "Do not start the quiz until every surviving question\n   passes verification",
      "- [ ] Phase 5c: verification gate passed (questions + claims grounded)",
    ]);
  });

  it("pins Mermaid concept + architecture maps in the vault", () => {
    requireTerms(skillText, [
      "### Generate concept + architecture maps (Mermaid)",
      "**Concept map per section**",
      "**Architecture diagram**",
      "StudyVault/00-Dashboard/MOC.md",
      "omit the edge — never invent structure",
      "- [ ] Phase 5a: Mermaid concept + architecture maps embedded in vault",
    ]);
  });

  it("pins mastery tracking that drives weakest-first, big-picture-first selection", () => {
    requireTerms(skillText, [
      "### Mastery tracking drives question selection (know what's left)",
      "before every question, update it after every answer",
      "`known % = mastered concepts / total concepts`",
      "**Select weakest-first, big-picture-first.**",
      "lowest known %",
      "Never re-ask a mastered concept while not-known ones remain",
      "**Stop condition.**",
      "Never spend questions on already-known areas",
    ]);
  });

  it("pins mastery threshold, retention re-test, and interleave mode", () => {
    requireTerms(skillText, [
      "**Mastery threshold before 🟢.**",
      "two correct answers**, including at least one **applied/analysis**",
      "Record one recall-only correct as 🟡",
      "**Within-session retention re-test.**",
      "downgrade to 🔴, teach again",
      "No cross-session scheduler — artifact-only",
      "**Interleave mode.**",
      "interleaved** questions\n  that mix sections",
    ]);
  });

  it("pins applied/transfer tasks for codebase runs", () => {
    requireTerms(skillText, [
      "### Applied / transfer tasks (do, don't just recall)",
      "**locate-owner**",
      "**where-to-add**",
      "**trace-the-bug**",
      "**blast-radius**",
      "graded against the **staged repo**",
      "real staged file paths",
    ]);
  });

  it("pins practice-file quality audit after tutor-setup", () => {
    requireTerms(skillText, [
      "### Practice-file quality (tutor-setup output)",
      "Cap list-recall at ~30%",
      "Short concept tracker labels",
      "Keep MOC Weak Areas live",
      "Rendering modes ≠ delivery ladder",
      "Quiz-fix loop",
      "Ground applied tasks",
      "Split coarse concept trackers",
    ]);
  });

  it("pins the SSO-not-idle behavior and no-MCP-repair constraint", () => {
    requireTerms(skillText, [
      "follow the background-and-poll pattern\nrather than idling",
      'Never reconfigure or "repair" an MCP server',
      "Do **not** reconfigure MCP servers on failure",
    ]);
  });

  it("keeps eval metadata spec-valid and unique", () => {
    expect(evals.skill_name).toBe("learn-project");
    expect(evals.evals.length).toBe(20);
    expect(new Set(evals.evals.map((skillEval) => skillEval.id)).size).toBe(evals.evals.length);

    for (const skillEval of evals.evals) {
      expect(skillEval.prompt.trim(), `eval ${skillEval.id} prompt`).not.toBe("");
      expect(skillEval.expected_output.trim(), `eval ${skillEval.id} expected_output`).not.toBe("");
      expect(
        (skillEval.expectations ?? skillEval.assertions ?? []).length,
        `eval ${skillEval.id} needs at least four expectations/assertions`,
      ).toBeGreaterThanOrEqual(4);
    }
  });

  it("preserves the real multi-source onboarding scenario (the driving example)", () => {
    const real = evalById(1);
    requireTerms(real.prompt, [
      "workspace-rfcs/pull/77",
      "workspace-app/pull/7",
      "docs.google.com/document/d/example-workspace-design",
      "PROJ-123",
      "~/apps",
    ]);
    requireTerms(expectationText(real), [
      "including the RFC PR's changed-file content",
      "Fetches ALL tabs of the Google Doc via list_document_tabs",
      "pulls child epics/stories via parentKeys",
      "not as owner/repo shorthand that resolves to public github.com",
      "presents a concise learning brief, then starts /tutor",
      "randomize the correct option's position",
    ]);
  });

  it("keeps stage-resume, prerequisite, and blocked-source scenarios discoverable", () => {
    requireTerms(scenarioText(evalMatching(/just quiz me now/i)), [
      /detect the current stage/i,
      /Resumes at the correct phase/i,
      /instead of re-gathering sources/i,
    ]);
    requireTerms(scenarioText(evalMatching(/isn't installed/i)), [
      /agentbrew install --from bevibing\/tutor-skills/i,
      /Refuses to fabricate a StudyVault/i,
    ]);
    requireTerms(scenarioText(evalMatching(/SSO login page/i)), [
      /does not idle on the SSO page/i,
      /Never reconfigures or 'repairs' an MCP server/i,
      /lists the missing\/blocked sources/i,
    ]);
  });

  it("preserves the quiz-quality (understanding-over-trivia) scenario", () => {
    const quiz = evalMatching(/memorize requirement IDs/i);
    requireTerms(expectationText(quiz), [
      "not recall of terminology, list names, or requirement/spec IDs",
      "self-contained and unambiguous",
      "clean, natural, grammatical English",
      "ordered major-first",
      "correct option is randomly positioned across questions",
      "'I don't know — teach me' option",
      "concise, refined learning brief is presented before the quiz starts",
      "traces to a staged source (cite-or-refuse)",
      "discards it and regenerates a meaning-based, cleanly-worded version",
    ]);
  });

  it("preserves the mastery-tracking (know-what's-left) scenario", () => {
    const mastery = evalMatching(/track what I know per section/i);
    requireTerms(expectationText(mastery), [
      "mastery % per section in the Learning Dashboard as coverage (mastered concepts / total concepts)",
      "Reads the tracker before each question and updates it after each answer",
      "Selects the next question from the section with the lowest known %",
      "most fundamental big-picture concept still not-known before any detail",
      "treats a section as done only at 100% known",
    ]);
  });

  it("preserves the verification-gate (answer-from-vault) scenario", () => {
    const verify = evalMatching(/verify every question is actually answerable/i);
    requireTerms(expectationText(verify), [
      "pre-quiz verification pass after the vault exists and before /tutor starts",
      "using only vault notes (not staged sources directly or general knowledge)",
      "Discards and regenerates any question the vault cannot uniquely answer",
      "marks unsupported claims source: unverified or omits them",
      "Reports how many questions passed, were discarded/regenerated, and claims flagged",
      "Verification Log.md",
      "passes verification",
    ]);
  });

  it("preserves the mastery-threshold and interleave scenario", () => {
    const threshold = evalMatching(/Don't mark a concept as mastered/i);
    requireTerms(expectationText(threshold), [
      "Does not flip a concept to known after a single correct MCQ",
      "two corrects including one applied/analysis",
      "Re-tests a concept later in the same session after intervening questions",
      "interleaved cross-section questions once big-picture basics",
      "no cross-session spaced-repetition scheduler",
    ]);
  });

  it("preserves the applied-transfer-tasks scenario", () => {
    const applied = evalMatching(/find things in the actual repo/i);
    requireTerms(expectationText(applied), [
      "locate-owner, where-to-add, trace-the-bug, and blast-radius",
      "real staged file paths under sources/repos/",
      "Teaches from vault notes and staged files on wrong answers",
    ]);
  });

  it("preserves the Mermaid concept-map scenario", () => {
    const maps = evalMatching(/concept maps and an architecture diagram/i);
    requireTerms(expectationText(maps), [
      "Mermaid concept maps with one diagram per section",
      "architecture diagram from staged repos and architecture notes",
      "StudyVault/00-Dashboard/MOC.md",
      "Omits uncited relationships",
      "fenced mermaid code blocks",
    ]);
  });

  it("preserves the source-freshness incremental re-stage scenario", () => {
    const freshness = evalMatching(/updated the design doc since last time/i);
    requireTerms(expectationText(freshness), [
      "manifest.json freshness (changed / unchanged keys and per-source contentHash)",
      "Re-stages only changed inputs on aggregator re-run",
      "freshness.changed is non-empty and a StudyVault exists",
      "Re-runs /tutor-setup for affected sections only",
      "which sources changed vs were skipped unchanged",
    ]);
  });

  it("preserves the mixed-mode repo plus web plus PDF scenario", () => {
    const mixed = evalMatching(/code and docs together/i);
    requireTerms(expectationText(mixed), [
      "mixed mode when repo plus non-code sources are present",
      "WebFetch saves the wiki page",
      "Stages the PDF with --file",
      "mixed mode (Document Mode over all sources/ material)",
      "cite-or-refuse paths",
    ]);
  });

  it("preserves the explicit start-over scenario", () => {
    const reset = evalMatching(/Start over — wipe/i);
    requireTerms(expectationText(reset), [
      "Clears or replaces the staging root when the user explicitly requests start over",
      "Does not resume at Phase 6 when start-over was requested",
      "Re-runs the full pipeline from intake after clearing",
      "current directory as the local repo source after reset",
    ]);
  });

  it("preserves the ~/apps shortlist confirmation scenario", () => {
    const apps = evalMatching(/scan ~\/apps and stage every repo/i);
    requireTerms(expectationText(apps), [
      "Lists ~/apps",
      "does not blindly --local every folder",
      "Confirms the shortlist with the user before copying/cloning many large repos",
      "Stages only the confirmed repos with --local",
    ]);
  });

  it("preserves the learning-brief cite-or-refuse scenario", () => {
    const brief = evalMatching(/learning brief before the quiz/i);
    requireTerms(expectationText(brief), [
      "learning brief after the vault exists and before /tutor starts",
      "Leads with big picture then highest-importance concepts",
      "Grounds every factual claim in a staged source path",
      "Links each concept to the vault note",
      "Confirms the user has read the brief",
    ]);
  });

  it("preserves the focus-areas weighting scenario", () => {
    const focus = evalMatching(/Focus only on authentication and security/i);
    requireTerms(expectationText(focus), [
      "Records focus areas from intake",
      "Weights tutor-setup coverage and vault organization toward stated focus areas",
      "Does not skip tutor-setup quality checklist phases",
      "prioritizes lowest-known sections within the focus scope",
      "focus narrows scope, not cite-or-refuse",
    ]);
  });

  it("preserves the practice-file recall-cap audit scenario", () => {
    const practice = evalMatching(/name the four X/i);
    requireTerms(expectationText(practice), [
      "Audits * Practice.md files after tutor-setup and before /tutor",
      "Rewrites pure list/name/ID recall questions into scenario-based application or analysis",
      "at most ~30% of practice questions as pure recall",
      "short canonical labels in concepts/*.md tracker rows",
      "Populates or refreshes MOC §Weak Areas from the Learning Dashboard",
    ]);
  });

  it("preserves the quiz-fix loop scenario", () => {
    const loop = evalById(20);
    requireTerms(loop.prompt, [/quiz-fix loop/i, /wrong practice answers/i]);
    requireTerms(expectationText(loop), [
      "Fixes wrong practice-file answers before re-quizzing",
      "at most ~30%",
      "Verification Log.md",
      "sources/repos/",
      "B5–B11",
      "no P0/P1 gaps remain",
    ]);
  });
});
