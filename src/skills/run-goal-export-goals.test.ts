import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const skillRoot = join(process.cwd(), "skill-plugins", "workflow", "run-goal");
const exporter = join(skillRoot, "scripts", "export-goals.py");
const scratch = mkdtempSync(join(tmpdir(), "run-goal-export-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const OUTSIDE_PATH = ["", "Users", "someone", "private", "x.txt"].join("/");
const FAKE_TOKEN = `ghp_${"A1b2C3d4".repeat(5)}`;

/** A scratch HOME with a fake private pattern and fixture goal files. */
function fixture(): { home: string; state: string; out: string } {
  const home = mkdtempSync(join(scratch, "home-"));
  const state = join(home, ".cache", "agentbrew", "run-goal");
  mkdirSync(state, { recursive: true });
  mkdirSync(join(home, ".config", "oss-readiness"), { recursive: true });
  writeFileSync(
    join(home, ".config", "oss-readiness", "oss-readiness.env"),
    "OSS_READINESS_INTERNAL_PATTERN='acmecorp|secretproj'\n",
  );
  writeFileSync(
    join(state, "aaaaaaaa-1111.contract.md"),
    [
      "# Goal contract — demo",
      "",
      `Raw goal: ship the AcmeCorp widget from  with key ${FAKE_TOKEN} and a very long tail of words after it`,
      "",
      "## Done when",
      "1. first",
      "2. second",
      "3. third",
      "",
      "## Metric",
      "- not a criterion",
    ].join("\n"),
  );
  writeFileSync(
    join(state, "aaaaaaaa-1111.retro.md"),
    [
      "# Retro",
      "Goal result: partly met (2/3 met)",
      "",
      "## What went wrong",
      "- secretproj gate timed out; mail me at owner@example.com",
      "  - nested detail is not an item",
      "## Skills updated",
      "- run-goal: eval — https://github.com/fyodoriv/agentbrew/pull/12",
      "- watch-issues: fix — https://github.com/fyodoriv/agentbrew/pull/12 and https://github.com/fyodoriv/agentbrew/pull/13",
    ].join("\n"),
  );
  writeFileSync(
    join(state, "bbbbbbbb-2222.contract.md"),
    "# Goal contract — open one\n\nRaw goal: tidy docs\n\n## Done when\n- one\n",
  );
  writeFileSync(join(state, "cccccccc-3333.retro.md"), "# Retro\n\n## What to improve\n- smaller steps\n");
  return { home, state, out: join(home, "out") };
}

function run(f: { home: string; state: string; out: string }) {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: f.home };
  delete env.RUN_GOAL_STATE_DIR;
  return spawnSync("python3", ["-I", exporter, "--out", f.out], { env, encoding: "utf-8" });
}

describe("run-goal export-goals.py", () => {
  const f = fixture();
  const r = run(f);
  const goals = JSON.parse(readFileSync(join(f.out, "goals.json"), "utf-8"));
  const items = JSON.parse(readFileSync(join(f.out, "retro_items.json"), "utf-8"));
  const byId = Object.fromEntries(goals.map((g: { goal_id: string }) => [g.goal_id, g]));

  it("exits 0 and reads the default state folder under HOME", () => {
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("goals=3 retro_items=4");
  });

  it("writes one goal row with counts, status, and distinct PR URLs", () => {
    expect(byId.aaaaaaaa).toMatchObject({ criteria: 3, met: 2, status: "partly met", prs: 2, retro_items: 3 });
    expect(byId.bbbbbbbb).toMatchObject({ criteria: 1, met: null, status: "open", prs: 0, title: "tidy docs" });
    expect(byId.cccccccc).toMatchObject({ status: "done", title: "", retro_items: 1 });
    expect(byId.aaaaaaaa.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("keeps titles to 80 characters and categories as headings", () => {
    expect(byId.aaaaaaaa.title.length).toBeLessThanOrEqual(80);
    expect(items.map((i: { category: string }) => i.category)).toEqual([
      "what went wrong",
      "skills updated",
      "skills updated",
      "what to improve",
    ]);
  });

  it("never outputs a private-pattern match, token, email, or outside path", () => {
    const all = ["goals.json", "retro_items.json", "manifest.json"]
      .map((n) => readFileSync(join(f.out, n), "utf-8"))
      .join("\n");
    expect(all).not.toMatch(/acmecorp|secretproj/i);
    expect(all).not.toContain(FAKE_TOKEN);
    expect(all).not.toMatch(/gh[pousr]_[A-Za-z0-9]{20,}|[\w.+-]+@[\w-]+\.\w+|\/Users\/|\/home\//);
    expect(all).toContain("[private]");
  });

  it("passes the owner's real private pattern too, when present", () => {
    const env = join(homedir(), ".config", "oss-readiness", "oss-readiness.env");
    if (!existsSync(env)) return;
    const m = readFileSync(env, "utf-8").match(/^\s*(?:export\s+)?OSS_READINESS_INTERNAL_PATTERN=(.*)$/m);
    if (!m) return;
    const pattern = new RegExp(m[1].trim().replace(/^['"]|['"]$/g, ""), "i");
    for (const n of ["goals.json", "retro_items.json"]) {
      expect(pattern.test(readFileSync(join(f.out, n), "utf-8"))).toBe(false);
    }
  });

  it("writes a manifest entry per dataset with a stale window", () => {
    const manifest = JSON.parse(readFileSync(join(f.out, "manifest.json"), "utf-8"));
    expect(manifest.map((m: { id: string }) => m.id)).toEqual(["goals", "retro_items"]);
    for (const m of manifest) {
      expect(m).toMatchObject({ file: `${m.id}.json`, staleAfterHours: 168 });
      expect(existsSync(join(f.out, m.file))).toBe(true);
    }
  });

  it("ships the page template and keeps SKILL.md under 500 lines", () => {
    const page = readFileSync(join(skillRoot, "dashboard", "index.html"), "utf-8");
    expect(page).toContain('data-source="goals"');
    expect(page).toContain('data-source="retro_items"');
    expect(readFileSync(join(skillRoot, "SKILL.md"), "utf-8").split("\n").length).toBeLessThan(500);
  });
});
