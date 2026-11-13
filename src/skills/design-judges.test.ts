/** The principal judge panel in ui-ux-rankings: issues become scores by a rubric. */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");
const SKILL = join(ROOT, "skill-plugins", "workflow", "ui-ux-rankings");
const judge = await import(join(SKILL, "scripts", "judge.mjs"));

describe("design judges", () => {
  it("scores a judge from its issues, and a blocker caps it", () => {
    const issues = judge.parse(
      "ISSUE: major | a.png | Keep | too loud | quiet it\nISSUE: minor | a.png | x | y | z\nnoise",
    );
    expect(issues).toHaveLength(2);
    expect(judge.scoreOf(issues)).toBe(8.7);
    expect(judge.scoreOf([{ severity: "blocker" }])).toBe(6);
    expect(judge.scoreOf([])).toBe(10);
  });

  it("scores a round, lists what two judges agree on, and passes only at the target", () => {
    const dir = mkdtempSync(join(tmpdir(), "judges-"));
    writeFileSync(
      join(dir, "a11y.txt"),
      "ISSUE: major | p.png | someone else button | icon has no visible label | add a word\n",
    );
    writeFileSync(
      join(dir, "copy.txt"),
      "ISSUE: minor | d.png | someone else button | icon has no label | add a word\n",
    );
    writeFileSync(join(dir, "polish.txt"), "NONE\n");
    writeFileSync(join(dir, "decisions.txt"), "row Keep stays quiet\n");
    const r = judge.score(dir, 8);
    expect(r.judges.map((j: { score: number }) => j.score)).toEqual([9, 9.7, 10]);
    expect(r.at_target).toBe(3);
    expect(r.consensus).toHaveLength(1);
    expect(r.consensus[0].judges).toBe(2);
  });

  it("the prompt is blind and carries settled decisions", () => {
    const p = judge.prompt({ lens: "a11y", shots: "/s", decisions: "row Keep stays quiet" });
    expect(p).toMatch(/row Keep stays quiet/);
    expect(p).toMatch(/ISSUE: <blocker\|major\|minor>/);
    expect(p).not.toMatch(/\b(score target|previous|last round|earlier score)\b/i);
    expect(Object.keys(judge.LENSES)).toHaveLength(10);
  });

  it("flags opposite asks in one round and against the ledger, and only those", () => {
    const dir = mkdtempSync(join(tmpdir(), "judges-"));
    // the comic-studio flip: one round removed the line, the next asked for it back
    writeFileSync(
      join(dir, "decisions.txt"),
      "R21: removed the 'No reason recorded' line under each failed card (3 of 3)\nrow Keep stays quiet\n",
    );
    writeFileSync(
      join(dir, "polish.txt"),
      "ISSUE: minor | d.png | 'No reason recorded' line | cards look unexplained | restore the line\n" +
        "ISSUE: minor | d.png | toolbar shadow | flat | darken the shadow\n",
    );
    writeFileSync(join(dir, "system.txt"), "ISSUE: minor | p.png | toolbar shadow | heavy | lighten the shadow\n");
    writeFileSync(join(dir, "copy.txt"), "ISSUE: major | p.png | page title | vague | change it to the book name\n");
    const c = judge.roundConflicts(dir);
    expect(c.map((x: { kind: string }) => x.kind).sort()).toEqual(["ledger", "round"]);
    expect(judge.direction("quiet the row Keep")).toBe("quiet");
    expect(judge.direction("change it")).toBe("");
    // a quiet ask that agrees with the ledger is not a conflict
    expect(
      judge.conflicts(
        [{ judge: "a", issues: [{ element: "row Keep", fix: "quiet it more" }] }],
        "row Keep stays quiet",
      ),
    ).toHaveLength(0);
  });

  it("reads only the first verb, past tense ledgers, declined asks, and short element names", () => {
    expect(judge.direction("change the label to 'Hide details'")).toBe("");
    expect(judge.direction("move it lower")).toBe("");
    expect(judge.direction("lightened the shadow")).toBe("lighten");
    expect(judge.direction("hid the badge")).toBe("hide");
    const ask = (fix: string, element = "toolbar shadow") => [{ judge: "a", issues: [{ element, fix }] }];
    const declined = "R24: asked and declined: darken the toolbar shadow (1 of 3)";
    expect(judge.conflicts(ask("darken the shadow"), declined)).toHaveLength(1);
    expect(judge.conflicts(ask("lighten the shadow"), declined)).toHaveLength(0);
    expect(judge.conflicts(ask("darken it"), "R22: lightened the toolbar shadow")).toHaveLength(1);
    // one shared word is not the same element
    expect(judge.conflicts(ask("darken it", "card shadow"), "R22: lightened the toolbar shadow")).toHaveLength(0);
    const nav = [
      { judge: "a", issues: [{ element: "nav", fix: "show labels" }] },
      { judge: "b", issues: [{ element: "nav", fix: "hide labels" }] },
    ];
    expect(judge.conflicts(nav)).toHaveLength(1);
  });

  it("flags a fix that offers two changes ('X or Y') so it is settled, not built", () => {
    const ask = (fix: string) => [{ judge: "a", issues: [{ element: "header", fix }] }];
    const c = judge.conflicts(ask("reduce the header by moving the tabs onto the logo row or into the bottom bar"));
    expect(c).toHaveLength(1);
    expect(c[0].kind).toBe("ambiguous");
    expect(judge.conflicts(ask("reduce the header padding to 8px"))).toHaveLength(0);
    // "or" inside a word or as "border"/"color" is not a second change
    expect(judge.conflicts(ask("change the border color to the ink token"))).toHaveLength(0);
  });

  it("the prompt lists each screenshot path, so judges need no ls", () => {
    const dir = mkdtempSync(join(tmpdir(), "shots-"));
    writeFileSync(join(dir, "b-phone.png"), "");
    writeFileSync(join(dir, "a-desktop.png"), "");
    writeFileSync(join(dir, "notes.txt"), "");
    const p = judge.prompt({ lens: "polish", shots: dir });
    expect(p).toContain(`- ${join(dir, "a-desktop.png")}\n- ${join(dir, "b-phone.png")}`);
    expect(p).not.toContain("notes.txt");
  });

  it("a named ledger that cannot be read fails instead of passing", () => {
    const dir = mkdtempSync(join(tmpdir(), "judges-"));
    writeFileSync(join(dir, "a.txt"), "NONE\n");
    expect(judge.roundConflicts(dir)).toEqual([]);
    expect(() => judge.roundConflicts(dir, join(dir, "missing.txt"))).toThrow();
  });

  it("the stop rule ends the recorded 30-round comic-studio run after 10 rounds instead of 60", () => {
    // blind panel means from the 2026-11-12 design-panel goal (round 0 = baseline)
    const storyboard = [
      6.13, 6.88, 6.63, 6.94, 6.83, 6.72, 6.95, 6.74, 6.75, 6.79, 6.97, 6.82, 7.01, 6.86, 6.93, 7.01, 6.97, 6.87, 7.1,
      6.95, 6.9, 7.09, 6.82, 7.08, 7.03, 6.99, 7.12, 7.12, 7.12, 7.19, 7.06,
    ];
    const catalogue = [
      5.13, 6.35, 6.56, 6.4, 6.41, 6.45, 6.76, 6.7, 6.74, 6.46, 6.48, 6.63, 6.64, 6.61, 6.48, 6.62, 6.68, 6.93, 6.64,
      6.79, 6.9, 6.93, 6.91, 6.94, 6.98, 6.9, 7.03, 7.04, 7.02, 7.0, 6.94,
    ];
    const sb = judge.stopRound(storyboard);
    const cat = judge.stopRound(catalogue);
    expect([sb, cat]).toEqual([
      { round: 6, reason: "stall" },
      { round: 4, reason: "stall" },
    ]);
    expect(sb.round + cat.round).toBe(10);
    // the best score lost by stopping early: storyboard ≤ 0.25, catalogue ≤ 0.5
    expect(Math.max(...storyboard) - Math.max(...storyboard.slice(0, sb.round + 1))).toBeLessThanOrEqual(0.25);
    expect(Math.max(...catalogue) - Math.max(...catalogue.slice(0, cat.round + 1))).toBeLessThanOrEqual(0.5);
    // the budget holds on a structural round: rounds 6-7 flat, round 8 structural and not flat
    expect(judge.stopRound([5, 5.5, 6, 6.5, 7, 7.5, 7.6, 7.7, 8.2, 8.3], 9)).toEqual({ round: 8, reason: "budget" });
    // exactly 0.30 counts as noise, despite float error
    expect(judge.stopRound([6.5, 6.8, 7.1, 7.4])).toEqual({ round: 3, reason: "stall" });
    expect(judge.stopRound([6, 6.5, 7, 7.5, 8.1], 8)).toEqual({ round: 4, reason: "target" });
    expect(judge.stopRound([5, 5.5, 6, 6.5, 7, 7.5, 8, 7.6, 7.2, 6.8], 9).reason).toBe("budget");
  });

  it("the prompt asks for a direction verb and forbids reversing settled decisions", () => {
    const p = judge.prompt({ lens: "polish", shots: "/s" });
    expect(p).toMatch(/direction verb/);
    expect(p).toMatch(/reverse a settled/);
    // live A/B 2026-11-13: judges re-asked for settled decisions and gave "X, or Y" fixes
    expect(p).toMatch(/not as decided:/);
    expect(p).toMatch(/never 'X, or Y'/);
  });

  it("both panels share one protocol and state no stop rule of their own", () => {
    const ref = (f: string) => readFileSync(join(SKILL, "references", f), "utf-8");
    const protocol = ref("judging-protocol.md");
    expect(protocol).toMatch(/decisions\.txt/);
    expect(protocol).toMatch(/judge\.mjs conflicts/);
    for (const f of ["design-panel.md", "design-judges.md"]) {
      expect(ref(f)).toMatch(/judging-protocol\.md/);
      expect(ref(f)).not.toMatch(/DECISIONS\.md|two rounds (in a row )?(that )?gain less than 0\.3|about 10 rounds/i);
    }
  });

  it("the skill reads and writes its learnings, and shared rules load it for UI work", () => {
    const skill = readFileSync(join(SKILL, "SKILL.md"), "utf-8");
    expect(skill).toMatch(/judge-learnings\.md/);
    expect(readFileSync(join(SKILL, "references", "judge-learnings.md"), "utf-8")).toMatch(/\| 20\d\d-\d\d-\d\d \|/);
    expect(readFileSync(join(ROOT, "docs", "shared-rules.md"), "utf-8")).toMatch(/design-judges\.md/);
  });
});
