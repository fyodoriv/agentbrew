import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateEvals } from "./validate.js";

const root = process.cwd();
const skillRoot = join(root, "skill-plugins/workflow/report-upstream");
const skill = readFileSync(join(skillRoot, "SKILL.md"), "utf8");
const contributing = readFileSync(join(root, "CONTRIBUTING.md"), "utf8");
const plan = readFileSync(join(root, "docs/plans/report-upstream-scoped-consent-792.md"), "utf8");
const evals = JSON.parse(readFileSync(join(skillRoot, "evals/evals.json"), "utf8")).evals as Array<{
  id: number;
  prompt: string;
  expected_output: string;
  expectations: string[];
}>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

const digest = (text: string) => createHash("sha256").update(text).digest("hex");

describe("report-upstream scoped consent and freshness guidance (#792)", () => {
  it("group 1: reuses exact finding/action/destination approval without widening it", () => {
    expect(skill).toMatch(/reuse[^.]*existing approval/i);
    expect(skill).toMatch(/exact finding[^.]*action[^.]*destination/i);
    expect(skill).toMatch(/tool name alone[^.]*not/i);
    expect(skill).toMatch(/issue approval[^.]*does not cover[^.]*comment[^.]*reopen[^.]*PR/i);
    expect(contributing).toMatch(/already approved[^.]*same finding[^.]*action[^.]*destination/i);
  });

  it("group 2: verifies the fetched default source and actual fix before drafting", () => {
    expect(skill).toMatch(/before drafting[^.]*upstream[^.]*default/i);
    expect(skill).toMatch(/fetch[^.]*default[^.]*without changing[^.]*checkout/i);
    expect(skill).toMatch(/linked fix[^.]*fetched[^.]*source/i);
    expect(skill).toMatch(/drop[^.]*only[^.]*source evidence[^.]*exact defect[^.]*fixed/i);
    expect(skill).toMatch(/scrub[^.]*preview[^.]*each[^.]*draft/i);
    expect(skill).toMatch(/posted URLs/i);
  });

  it("group 3: keeps closed-but-unfixed findings and requires approval for a changed action", () => {
    expect(skill).toMatch(/closed label[^.]*not proof[^.]*fix/i);
    expect(skill).toMatch(/same finding[^.]*existing thread[^.]*duplicate/i);
    expect(skill).toMatch(/comment or reopen[^.]*separate approval[^.]*new action/i);
    expect(skill).toMatch(/do not silently drop[^.]*unresolved/i);
  });

  it("group 4: leaves unavailable fresh state unknown with a saved draft and pending checks", () => {
    expect(skill).toMatch(/fetch[^.]*issue lookup[^.]*source verification[^.]*fails[^.]*unknown/i);
    expect(skill).toMatch(/saved?[^.]*scrubbed draft[^.]*pending[^.]*verification/i);
    expect(skill).toMatch(/do not[^.]*post[^.]*potential duplicate[^.]*unverified/i);
    expect(skill).toMatch(/do not[^.]*reset[^.]*clean[^.]*switch[^.]*owner settings/i);
  });

  it("puts the proposed change in the draft under an issue-only rule (#877)", () => {
    const draftStep = skill.slice(skill.indexOf("1. **Draft**"), skill.indexOf("2. **Scrub and preview**"));
    expect(draftStep).toMatch(/"issue, not PR"[^.]*do not own[^.]*proposed change[^.]*draft/i);
    expect(draftStep).toMatch(/previewed and approved issue body/i);
    expect(skill).toMatch(/"issue, not PR" rule, do not offer a fix PR/);
    const issueOnly = evals.find(({ id }) => id === 12);
    expect(issueOnly?.expectations).toContain(
      "the proposed diff or steps appear in the approved preview before posting",
    );
  });

  it("keeps the four registered objects exact while allowing later valid additions", () => {
    expect(digest(plan)).toBe("072bdab214dc7abfdb824c5d2b16f2333eb4778e42aad3e7eaafc68f86c52cca");
    const frozen = [...plan.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]));
    expect(frozen.map(({ id }) => id)).toEqual([8, 9, 10, 11]);
    expect(evals.slice(7, 11)).toEqual(frozen);
    expect(new Set(evals.map(({ id }) => id)).size).toBe(evals.length);
    expect(validateEvals(skillRoot)).toEqual([]);
  });

  it("preserves every original eval including tool-only consent and safety guards", () => {
    const original = `${JSON.stringify(canonical(evals.slice(0, 7)))}\n`;
    expect(digest(original)).toBe("ed293d44134035fdf33367f8dec50f31b406c5c5ef34bca0a343e7f3101ca11b");
    expect(evals[5].expected_output).toContain("the earlier blanket approval does not replace it");
    expect(skill).toMatch(/upstream-feedback\.off/);
    expect(skill).toMatch(/nobody is at the keyboard/);
    expect(skill).toMatch(/owns that repo/);
    expect(skill).toMatch(/re-scan reports anything left[^.]*never post it/s);
    expect(skill).toMatch(/Never post, comment, or open a PR without the person's yes/);
    expect(skill).toMatch(/second yes/);
  });
});
