import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function section(path: string, heading: string): string {
  const source = readFileSync(join(process.cwd(), path), "utf8");
  return (source.split(`## ${heading}\n`)[1]?.split("\n## ")[0] ?? "").replace(/\s+/g, " ");
}

const rule = section("docs/shared-rules.md", "Fresh-reader review");
const workflow = section("skill-plugins/workflow/review-pr/SKILL.md", "6. Draft, then post on a yes");

describe("fresh-reader review", () => {
  it("covers the full finished result before presentation", () => {
    expect(rule).toMatch(/Before showing any PR or finished agent result/);
    expect(rule).toMatch(/PR title, body, and proof; report; draft; dashboard; document; or final reply/);
  });

  it("gives a separate fresh subagent only the artifact and checklist", () => {
    expect(rule).toMatch(/separate fresh subagent without conversation history/);
    expect(rule).toMatch(/only the exact finished artifact and the readability checklist/);
    expect(rule).toMatch(/Never send the author's summary/);
  });

  it("rejects opaque language and missing context", () => {
    expect(rule).toMatch(
      /jargon, an unexplained ID or term, a missing what or why, or any part the reader cannot follow/,
    );
  });

  it("fails a draft whose recommended option is not first", () => {
    expect(rule).toMatch(
      /When the artifact lists options, also return FAIL if the recommended option is not first or not labeled "Recommended"/,
    );
  });

  it("rechecks each revision and holds unreviewed work", () => {
    expect(rule).toMatch(/Revise and judge again until the exact artifact gets PASS/);
    expect(rule).toMatch(/If a fresh subagent is unavailable or the artifact still fails, hold the artifact/);
    expect(rule).toMatch(/report which check is blocked/);
  });

  it("adds a separate review-pr gate after fact approval and before showing", () => {
    expect(workflow).toMatch(
      /After `APPROVED`, run the separate \[fresh-reader review\].*exact artifact.*After the fresh reader gives PASS, show/,
    );
    expect(rule).toMatch(/in addition to all required reality and functional checks/);
  });

  it("keeps independent functional proof and fact-informed review", () => {
    expect(workflow).toMatch(/independent functional PASS with live proof; fix every failure before writing the ask/);
    expect(workflow).toMatch(/fresh judge subagent with the PR facts/);
    expect(workflow).toMatch(/Fix each `REJECTED` line/);
  });

  it("runs the same gate before posting or publishing", () => {
    expect(rule).toMatch(/Apply this review before posting or publishing the artifact/);
  });

  it("lets the fresh reader return its internal verdict without another review", () => {
    expect(rule).toMatch(/The fresh reader can send its verdict back to the author without another review/);
  });

  it("allows a brief notice without disclosing held content", () => {
    expect(rule).toMatch(
      /A brief progress or blocker notice can skip this review if it reveals none of the held artifact/,
    );
  });

  it("reviews the exact posted form and rechecks changes", () => {
    expect(workflow).toMatch(
      /Before either text review, prepare the exact review body or inline comments, including the required attribution footer\..*fresh judge subagent with the PR facts.*run the separate \[fresh-reader review\]/,
    );
    expect(workflow).toMatch(/Post only the text and delivery form the user approved/);
    expect(workflow).toMatch(
      /If the text or form changes, repeat both text reviews and get approval for the revised draft/,
    );
  });
});
