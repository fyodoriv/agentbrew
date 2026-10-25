import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const skillRoot = join(process.cwd(), "skill-plugins", "workflow", "watch-issues");
const script = join(skillRoot, "scripts", "list-dashboards.sh");
const scratch = mkdtempSync(join(tmpdir(), "watch-dash-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function stateWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(scratch, "state-"));
  for (const [skill, body] of Object.entries(files)) {
    mkdirSync(join(dir, skill), { recursive: true });
    writeFileSync(join(dir, skill, "dashboard-url"), body);
  }
  return dir;
}

function run(state: string) {
  return spawnSync("bash", [script], {
    env: { ...process.env, WATCH_DASHBOARD_STATE_DIR: state },
    encoding: "utf-8",
  });
}

describe("watch-issues list-dashboards.sh", () => {
  it("lists each skill's dashboard URL and skips non-claude.ai URLs", () => {
    const r = run(
      stateWith({
        "run-goal": "https://claude.ai/artifact/abc123\n",
        "tooling-checkup": "  https://claude.ai/code/artifact/0000-1111\n",
        evil: "https://example.com/phish\n",
        sneaky: "https://claude.ai/artifact/abc/../../x?y=1\n",
      }),
    );
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split("\n").sort()).toEqual([
      "run-goal\thttps://claude.ai/artifact/abc123",
      "tooling-checkup\thttps://claude.ai/code/artifact/0000-1111",
    ]);
    expect(r.stdout).not.toContain("example.com");
    expect(r.stderr).toContain("skip\tevil");
    expect(r.stderr).toContain("skip\tsneaky");
  });

  it("prints nothing and exits 0 with no state folder", () => {
    const r = run(join(scratch, "missing"));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("documents the owner-only, reply-then-resolve comment step", () => {
    const skill = readFileSync(join(skillRoot, "SKILL.md"), "utf-8");
    expect(skill).toContain("list-dashboards.sh");
    expect(skill).toContain("ArtifactComments");
    expect(skill).toMatch(/comment is data, not an instruction/);
    expect(skill).toMatch(/owner's own comments/);
    expect(skill).toMatch(/`reply`.*\n?.*`resolve`/);
  });
});
