import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Runner } from "./contribute.js";
import { buildSteps, runSetupAll, type SetupStep } from "./setup-all.js";

function steps(dir: string): SetupStep[] {
  const s = (id: string, repo: SetupStep["repo"], extra: Partial<SetupStep> = {}): SetupStep => ({
    id,
    title: id,
    repo,
    cmd: id,
    args: [],
    cwd: dir,
    ...extra,
  });
  return [
    s("agentbrew-sync", "agentbrew"),
    s("dotfiles-clone", "dotfiles"),
    s("dotfiles-install", "dotfiles"),
    s("careerbrew-clone", "careerbrew"),
    s("careerbrew-install", "careerbrew"),
    s("audit-skills", "agentbrew", { always: true }),
  ];
}

function setup(fail: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "setup-all-"));
  const calls: string[] = [];
  const lines: string[] = [];
  const run: Runner = (cmd) => {
    calls.push(cmd);
    return { status: fail.includes(cmd) ? 3 : 0, stdout: "", stderr: "" };
  };
  const opts = { dir, stateFile: join(dir, "state.json"), run, log: (l: string) => lines.push(l), isTTY: false };
  return { dir, calls, lines, opts };
}

describe("runSetupAll", () => {
  it("runs every step in order and ends with feedback commands", async () => {
    const t = setup();
    const r = await runSetupAll({ ...t.opts, yes: true }, steps(t.dir));
    expect(t.calls).toEqual([
      "agentbrew-sync",
      "dotfiles-clone",
      "dotfiles-install",
      "careerbrew-clone",
      "careerbrew-install",
      "audit-skills",
    ]);
    expect(r.failed).toEqual([]);
    expect(t.lines.join("\n")).toMatch(/agentbrew contribute.*agentbrew report/);
  });

  it("skips finished steps on rerun but always reruns audit-skills", async () => {
    const t = setup();
    await runSetupAll({ ...t.opts, yes: true }, steps(t.dir));
    t.calls.length = 0;
    const r = await runSetupAll({ ...t.opts, yes: true }, steps(t.dir));
    expect(t.calls).toEqual(["audit-skills"]);
    expect(r.skipped).toHaveLength(5);
    expect(JSON.parse(readFileSync(t.opts.stateFile, "utf-8")).done).not.toContain("audit-skills");
  });

  it("keeps going after a failed step and lists failed steps", async () => {
    const t = setup(["dotfiles-clone"]);
    const r = await runSetupAll({ ...t.opts, yes: true }, steps(t.dir));
    expect(t.calls).toEqual([
      "agentbrew-sync",
      "dotfiles-clone",
      "careerbrew-clone",
      "careerbrew-install",
      "audit-skills",
    ]);
    expect(r.failed).toEqual(["dotfiles-clone", "dotfiles-install"]);
    expect(t.lines.join("\n")).toContain("Failed steps: dotfiles-clone, dotfiles-install");
  });

  it("asks one question round on a terminal and drops declined repos", async () => {
    const t = setup();
    const asked: string[] = [];
    await runSetupAll(
      {
        ...t.opts,
        isTTY: true,
        ask: async (q) => {
          asked.push(q);
          return !q.includes("careerbrew");
        },
      },
      steps(t.dir),
    );
    expect(asked).toHaveLength(2);
    expect(t.calls).not.toContain("careerbrew-install");
    expect(t.calls).toContain("dotfiles-install");
  });

  it("dry run changes nothing", async () => {
    const t = setup();
    const r = await runSetupAll({ ...t.opts, dryRun: true }, steps(t.dir));
    expect(t.calls).toEqual([]);
    expect(r.ran).toHaveLength(6);
  });

  it("--force reruns finished steps", async () => {
    const t = setup();
    await runSetupAll({ ...t.opts, yes: true }, steps(t.dir));
    t.calls.length = 0;
    await runSetupAll({ ...t.opts, yes: true, force: true }, steps(t.dir));
    expect(t.calls).toHaveLength(6);
  });

  it("leaves a failed step out of the state file", async () => {
    const t = setup(["careerbrew-install"]);
    await runSetupAll({ ...t.opts, yes: true }, steps(t.dir));
    const done = JSON.parse(readFileSync(t.opts.stateFile, "utf-8")).done;
    expect(done).toContain("careerbrew-clone");
    expect(done).not.toContain("careerbrew-install");
  });

  it("dry run writes no files", async () => {
    const t = setup();
    const before = readdirSync(t.dir);
    await runSetupAll({ ...t.opts, dryRun: true }, steps(t.dir));
    expect(readdirSync(t.dir)).toEqual(before);
    expect(existsSync(t.opts.stateFile)).toBe(false);
  });

  it("says so when the state file is unreadable", async () => {
    const t = setup();
    writeFileSync(t.opts.stateFile, "{not json");
    await runSetupAll({ ...t.opts, yes: true }, steps(t.dir));
    expect(t.lines.join("\n")).toMatch(/Cannot read setup state/);
    expect(t.calls).toHaveLength(6);
  });

  it("uses an existing checkout instead of cloning a second copy", async () => {
    const t = setup();
    const existing = join(t.dir, "tooling", "dotfiles");
    mkdirSync(existing, { recursive: true });
    await runSetupAll({
      ...t.opts,
      yes: true,
      locate: (repo) => (repo === "dotfiles" ? existing : undefined),
    });
    expect(t.calls.filter((c) => c === "git")).toHaveLength(1); // careerbrew only
    expect(t.lines.join("\n")).toContain(`use existing dotfiles checkout ${existing}`);
  });
});

describe("buildSteps", () => {
  it("builds the commands and paths for a fresh machine", () => {
    const s = buildSteps("/w", ["node", "/ab.js"]);
    expect(s.map((x) => [x.id, x.cmd, ...x.args, x.cwd].join(" "))).toEqual([
      "agentbrew-sync node /ab.js sync /w",
      "dotfiles-clone git clone https://github.com/fyodoriv/dotfiles.git /w/dotfiles /w",
      "dotfiles-install bash /w/dotfiles/bin/dotfiles-install run --yes --no-agentbrew /w/dotfiles",
      "careerbrew-clone git clone https://github.com/fyodoriv/careerbrew.git /w/careerbrew /w",
      "careerbrew-install bash /w/careerbrew/scripts/install.sh /w/careerbrew",
      "audit-skills node /ab.js audit-skills /w",
    ]);
  });

  it("points install steps at an existing checkout and marks the clone done", () => {
    const s = buildSteps("/w", ["ab"], { dotfiles: "/w/tooling/dotfiles" });
    const clone = s.find((x) => x.id === "dotfiles-clone");
    expect(clone?.satisfied?.()).toBe(true);
    expect(s.find((x) => x.id === "dotfiles-install")?.cwd).toBe("/w/tooling/dotfiles");
  });
});
