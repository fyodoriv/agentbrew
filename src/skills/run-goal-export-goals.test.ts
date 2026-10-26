import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const skillRoot = join(process.cwd(), "skill-plugins", "workflow", "run-goal");
const exporter = join(skillRoot, "scripts", "export-goals.py");
const scratch = mkdtempSync(join(tmpdir(), "run-goal-export-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const HOME_PREFIX = ["", "Users", "someone"].join("/");
const OUTSIDE_PATH = `${HOME_PREFIX}/private/x.txt`;
const TOOLING_PATH = `${HOME_PREFIX}/apps/tooling/agentbrew/src/a.ts`;
const HEX_KEY = "0123456789abcdef".repeat(2);
const FAKE_TOKEN = `ghp_${"A1b2C3d4".repeat(5)}`;

/** A scratch HOME with a fake private pattern and fixture goal files. */
function fixture(): { home: string; state: string; out: string } {
  const home = mkdtempSync(join(scratch, "home-"));
  const state = join(home, ".cache", "agentbrew", "run-goal");
  mkdirSync(state, { recursive: true });
  mkdirSync(join(home, ".config", "oss-readiness"), { recursive: true });
  writeFileSync(
    join(home, ".config", "oss-readiness", "oss-readiness.env"),
    "OSS_READINESS_INTERNAL_PATTERN='acme[[:space:]]corp|secret[[:alpha:]]+proj'\n",
  );
  writeFileSync(
    join(state, "aaaaaaaa-1111.contract.md"),
    [
      "# Goal contract — demo",
      "",
      `Raw goal: ship the Acme Corp widget from ${OUTSIDE_PATH} with ${FAKE_TOKEN} and a very long tail of words after it`,
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
      "- secretxproj gate timed out; mail me at owner@example.com; see /Volumes/Ext/x and /mnt/data/y",
      `- edited ${TOOLING_PATH} with api_key=${HEX_KEY}, token=tok.short.v and Bearer abc.def; raw ${HEX_KEY}`,
      "- not a result: the Goal result: met line must start the line",
      "  - nested detail is not an item",
      `- hosts build01.corp.example.net, https://wiki.int.lan/page, 10.2.3.4 and 192.168.1.9`,
      "- paths /srv/jdoe/z, /root/q, /usr/local/home/jdoe/w and C:\\Users\\jdoe\\x",
      "- short sk-abc123 and ghp_shortTok1; the password is hunter2, passwd hunter3",
      "## Skills updated",
      "- run-goal: eval — https://github.com/fyodoriv/agentbrew/pull/12",
      "- watch-issues: fix — https://github.com/fyodoriv/agentbrew/pull/12 and https://github.com/fyodoriv/agentbrew/pull/13",
      "- dotfiles: fyodoriv/dotfiles#9 and PR #7, again PR #7",
    ].join("\n"),
  );
  writeFileSync(
    join(state, "bbbbbbbb-2222.contract.md"),
    "# Goal contract — open one\n\nRaw goal: tidy docs\n\n## Done when\n- one\n",
  );
  writeFileSync(
    join(state, "cccccccc-3333.retro.md"),
    "# Retro\nWe wrote Goal result: met in prose only.\n\n## What to improve\n- smaller steps\n",
  );
  writeFileSync(join(state, "dddddddd-4444.pending"), "");
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
    expect(r.stdout).toContain("goals=3 retro_items=10");
  });

  it("writes one goal row with counts, status, and distinct PR URLs", () => {
    expect(byId.aaaaaaaa).toMatchObject({ criteria: 3, met: 2, status: "partly met", prs: 4, retro_items: 9 });
    expect(byId.bbbbbbbb).toMatchObject({ criteria: 1, met: null, status: "open", prs: 0, title: "tidy docs" });
    expect(byId.cccccccc).toMatchObject({ status: "done", title: "", retro_items: 1 });
    expect(byId.aaaaaaaa.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("keeps titles to 80 characters and categories as headings", () => {
    expect(byId.aaaaaaaa.title.length).toBeLessThanOrEqual(80);
    expect(items.map((i: { category: string }) => i.category)).toEqual([
      "what went wrong",
      "what went wrong",
      "what went wrong",
      "what went wrong",
      "what went wrong",
      "what went wrong",
      "skills updated",
      "skills updated",
      "skills updated",
      "what to improve",
    ]);
  });

  const all = ["goals.json", "retro_items.json", "manifest.json"]
    .map((n) => readFileSync(join(f.out, n), "utf-8"))
    .join("\n");

  it("replaces private-pattern matches (grep -iE) with [private]", () => {
    expect(all).not.toMatch(/acme\s?corp|secretxproj/i);
    expect(all).toContain("[private]");
  });

  it("rewrites /Users/<name> to ~ and keeps ~/apps/tooling paths", () => {
    expect(all).not.toContain(HOME_PREFIX);
    expect(all).not.toMatch(/\/Users\/|\/home\//);
    expect(all).toContain("~/apps/tooling/agentbrew/src/a.ts");
    expect(all).not.toContain(OUTSIDE_PATH);
  });

  it("redacts bare 32+ character keys and known token shapes", () => {
    expect(all).not.toContain(HEX_KEY);
    expect(all).not.toContain(FAKE_TOKEN);
    expect(all).not.toMatch(/gh[pousr]_[A-Za-z0-9]{20,}/);
  });

  it("redacts key=, token=, and Bearer values", () => {
    expect(all).toContain("api_key=[redacted]");
    expect(all).toContain("token=[redacted]");
    expect(all).not.toContain("tok.short.v");
    expect(all).toContain("Bearer [redacted]");
    expect(all).not.toContain("abc.def");
  });

  it("scrubs /Volumes and /mnt paths", () => {
    expect(all).not.toMatch(/\/Volumes\/|\/mnt\//);
  });

  it("replaces private hosts, intranet URLs, and RFC1918 IPs with [host]", () => {
    expect(all).not.toMatch(/build01|corp\.example\.net|wiki\.int\.lan|10\.2\.3\.4|192\.168\.1\.9/);
    expect(all).toContain("[host]");
    expect(all).toContain("https://github.com/fyodoriv/agentbrew/pull/12");
  });

  it("scrubs /srv, /root, /usr/local/home, and Windows user paths", () => {
    expect(all).not.toMatch(/\/srv\/|\/root\/|\/usr\/local\/home|jdoe/);
  });

  it("redacts short sk-/ghp_ tokens and spoken passwords", () => {
    expect(all).not.toMatch(/sk-abc123|ghp_shortTok1|hunter2|hunter3/);
  });

  it("scrubs emails", () => {
    expect(all).not.toMatch(/[\w.+-]+@[\w-]+\.\w+/);
  });

  it("counts PR #N and owner/repo#N references once each", () => {
    // pull/12 twice, pull/13, fyodoriv/dotfiles#9, PR #7 twice: 4 distinct.
    expect(byId.aaaaaaaa.prs).toBe(4);
  });

  it("passes the owner's real private pattern too, checked with grep -icE", () => {
    const env = join(homedir(), ".config", "oss-readiness", "oss-readiness.env");
    if (!existsSync(env)) return;
    const g = spawnSync(
      "bash",
      [
        "-c",
        'source "$1" >/dev/null 2>&1; grep -icE -- "$OSS_READINESS_INTERNAL_PATTERN" "$2" "$3"',
        "_",
        env,
        join(f.out, "goals.json"),
        join(f.out, "retro_items.json"),
      ],
      { encoding: "utf-8" },
    );
    for (const line of g.stdout.trim().split("\n")) expect(line.endsWith(":0"), line).toBe(true);
  });

  it("anchors Goal result to the start of a line", () => {
    expect(byId.cccccccc.status).toBe("done");
  });

  it("fails closed and writes nothing without the private pattern env file", () => {
    const g = fixture();
    rmSync(join(g.home, ".config", "oss-readiness"), { recursive: true });
    const r2 = run(g);
    expect(r2.status).toBe(2);
    expect(r2.stderr).toContain("refusing to export");
    expect(existsSync(g.out)).toBe(false);
  });

  it("fails closed when the env file has no pattern", () => {
    const g = fixture();
    writeFileSync(join(g.home, ".config", "oss-readiness", "oss-readiness.env"), "OTHER=1\n");
    expect(run(g).status).toBe(2);
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
