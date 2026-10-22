import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("checkup ends with a local HTML page", () => {
  it("report-html.sh shows the verdict, the blockers, the next steps, and escapes output", () => {
    const dir = mkdtempSync(join(tmpdir(), "checkup-html-"));
    const log = join(dir, "checkup.log");
    writeFileSync(
      log,
      "\n## 1. Open work\nPR #3 has a red check\nNext: finish PR #3 first\n\n## 2. Health\n✗ node missing\n\n## 3. Gate\nall passed <ok> & done\n\ncheckup: needs work (see above)\n",
    );
    const out = join(dir, "out", "checkup.html");
    execFileSync("bash", [join(root, "scripts", "report-html.sh"), "demo checkup", log, out]);
    const page = readFileSync(out, "utf-8");
    expect(page).toContain("<strong>Verdict:</strong> needs work (see above)");
    expect(page).toContain("<li>2. Health</li>");
    expect(page).toContain("<li>finish PR #3 first</li>");
    expect(page).toContain("all passed &lt;ok&gt; &amp; done");
    expect(page).toContain("prefers-color-scheme: dark");
  });

  it("the repo checkup and the new-project template both write the page and keep the same script", () => {
    expect(readFileSync(join(root, "scripts", "checkup.sh"), "utf-8")).toContain(".metrics/checkup.html");
    const template = "skill-plugins/workflow/new-project/templates/scripts";
    expect(readFileSync(join(root, template, "checkup.sh"), "utf-8")).toContain(".metrics/checkup.html");
    expect(readFileSync(join(root, template, "report-html.sh"), "utf-8")).toBe(
      readFileSync(join(root, "scripts", "report-html.sh"), "utf-8"),
    );
  });
});
