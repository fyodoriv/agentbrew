import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { afterAll, describe, expect, it } from "vitest";

const skillRoot = join(process.cwd(), "skill-plugins", "workflow", "new-project");
const scaffold = join(skillRoot, "scripts", "scaffold.sh");
const checkSetup = join(skillRoot, "scripts", "check-setup.sh");
const scratch = mkdtempSync(join(tmpdir(), "new-project-"));
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" };
const profiles = [
  { profile: "tool", stack: "ts" },
  { profile: "assistant", stack: "python" },
  { profile: "side-project", stack: "rust" },
] as const;

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function score(dir: string, profile: string, ...flags: string[]) {
  const run = spawnSync("bash", [checkSetup, dir, "--profile", profile, ...flags], { encoding: "utf-8", env });
  const match = /score: (\d+)\/(\d+)/.exec(run.stdout);
  expect(match, run.stdout + run.stderr).not.toBeNull();
  return { status: run.status, pass: Number(match?.[1]), total: Number(match?.[2]), out: run.stdout };
}

function scaffoldInto(dir: string, profile: string, stack: string) {
  return execFileSync("bash", [scaffold, dir, "--profile", profile, "--name", `demo-${profile}`, "--stack", stack], {
    encoding: "utf-8",
    env,
  });
}

describe("new-project skill", () => {
  it.each(profiles)("scaffolds a $profile repo that scores 100%", ({ profile, stack }) => {
    const dir = join(scratch, profile);
    scaffoldInto(dir, profile, stack);
    const result = score(dir, profile);
    expect(result.out).not.toContain("FAIL");
    expect(result.status).toBe(0);
    expect(readlinkSync(join(dir, "CLAUDE.md"))).toBe("AGENTS.md");
    expect(readFileSync(join(dir, "AGENTS.md"), "utf-8")).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it.each(profiles)("strict mode fails a fresh $profile scaffold until FILL: markers are replaced", ({ profile }) => {
    const dir = join(scratch, profile);
    expect(score(dir, profile, "--strict").status).toBe(1);
    execFileSync("bash", ["-c", "grep -rIl 'FILL:' . | xargs perl -pi -e 's/FILL:/Filled:/g'"], { cwd: dir });
    expect(score(dir, profile, "--strict").status).toBe(0);
  });

  it.each(profiles)("scores an empty dir at 20% or less for $profile", ({ profile }) => {
    const empty = join(scratch, `empty-${profile}`);
    mkdirSync(empty, { recursive: true });
    const result = score(empty, profile);
    expect(result.status).toBe(1);
    expect(result.pass / result.total).toBeLessThanOrEqual(0.2);
  });

  it("never overwrites an existing file", () => {
    const dir = join(scratch, "keep");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "README.md"), "mine\n");
    const out = scaffoldInto(dir, "tool", "none");
    expect(out).toContain("kept    README.md");
    expect(readFileSync(join(dir, "README.md"), "utf-8")).toBe("mine\n");
  });

  it("ships valid YAML templates and a valid evals file", () => {
    yaml.load(readFileSync(join(skillRoot, "templates", "assistant", "config", "models.yaml"), "utf-8"));
    yaml.loadAll(
      readFileSync(join(skillRoot, "templates", "assistant", "evals", "cases", "001-start-session.yaml"), "utf-8"),
    );
    const evals = JSON.parse(readFileSync(join(skillRoot, "evals", "evals.json"), "utf-8"));
    expect(evals.skill_name).toBe("new-project");
    expect(JSON.stringify(evals)).toMatch(/interview prep/);
  });
});
