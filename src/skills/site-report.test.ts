/** The whole-site usefulness audit report in ui-ux-rankings. */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");
const SKILL = join(ROOT, "skill-plugins", "workflow", "ui-ux-rankings");
const report = await import(join(SKILL, "scripts", "site-report.mjs"));

function round(scores: Record<string, number>, opened = 8) {
  const dir = mkdtempSync(join(tmpdir(), "site-round-"));
  for (const panel of ["design", "ux", "usefulness"]) {
    writeFileSync(
      join(dir, `${panel}.json`),
      JSON.stringify({
        panel,
        opened: panel === "ux" ? opened : 8,
        of: 8,
        views: Object.entries(scores).map(([view, score]) => ({
          view,
          score,
          verdict: panel === "usefulness" ? "keep" : undefined,
          elements: [{ element: "<b>card</b>", score: score - 10, reason: "r", fix: "f" }],
        })),
      }),
    );
  }
  return dir;
}

describe("site audit report", () => {
  it("lists pages worst first, escapes text, and fails below the target", () => {
    const out = mkdtempSync(join(tmpdir(), "site-out-"));
    const r = report.build(round({ home: 90, settings: 50 }, 3), out, { target: 80 });
    expect(r.pages.map((p: { view: string }) => p.view)).toEqual(["settings", "home"]);
    expect(r.pass).toBe(false);
    expect(r.warnings).toEqual(["ux.json (ux): opened 3 of 8"]);
    const html = readFileSync(join(out, "report.html"), "utf8");
    expect(html.indexOf("settings")).toBeLessThan(html.indexOf("home"));
    expect(html).toContain("&lt;b&gt;card&lt;/b&gt;");
    expect(html).not.toContain("<b>card</b>");
  });

  it("keeps a history across rounds and passes when every page meets the target", () => {
    const out = mkdtempSync(join(tmpdir(), "site-out-"));
    report.build(round({ home: 60 }), out, { round: "R1" });
    const r = report.build(round({ home: 85 }), out, { round: "R2" });
    expect(r.pass).toBe(true);
    const history = JSON.parse(readFileSync(join(out, "history.json"), "utf8"));
    expect(history).toEqual([
      { round: "R1", pages: { home: 60 } },
      { round: "R2", pages: { home: 85 } },
    ]);
    expect(readFileSync(join(out, "report.html"), "utf8")).toContain("<th>R2</th>");
  });
});
