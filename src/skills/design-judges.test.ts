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

  it("the skill reads and writes its learnings, and shared rules load it for UI work", () => {
    const skill = readFileSync(join(SKILL, "SKILL.md"), "utf-8");
    expect(skill).toMatch(/judge-learnings\.md/);
    expect(readFileSync(join(SKILL, "references", "judge-learnings.md"), "utf-8")).toMatch(/\| 20\d\d-\d\d-\d\d \|/);
    expect(readFileSync(join(ROOT, "docs", "shared-rules.md"), "utf-8")).toMatch(/design-judges\.md/);
  });
});
