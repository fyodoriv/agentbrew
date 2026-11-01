import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const skillRoot = join(process.cwd(), "skill-plugins", "workflow", "run-goal");
const script = join(skillRoot, "scripts", "stalled-agents.py");
const scratch = mkdtempSync(join(tmpdir(), "run-goal-stalled-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const NOW = 1_800_000_000;

/** A session folder with one agent per entry: [id, finished, minutes silent, extra meta]. */
function session(agents: [string, boolean, number, Record<string, unknown>?][]): { dir: string; tasks: string } {
  const dir = mkdtempSync(join(scratch, "session-"));
  const sub = join(dir, "subagents");
  const tasks = join(dir, "tasks");
  mkdirSync(sub, { recursive: true });
  mkdirSync(tasks, { recursive: true });
  for (const [id, finished, silent, extra] of agents) {
    const meta = { description: `Ship ${id}`, ...(finished ? { finished: true } : {}), ...extra };
    writeFileSync(join(sub, `agent-${id}.meta.json`), JSON.stringify(meta));
    const transcript = join(sub, `agent-${id}.jsonl`);
    writeFileSync(transcript, "{}\n");
    const at = NOW - silent * 60;
    utimesSync(transcript, at, at);
  }
  return { dir, tasks };
}

/** A background shell output file, last written `minutesAgo` before NOW. */
function output(s: { tasks: string }, name: string, text: string, minutesAgo: number) {
  const path = join(s.tasks, `${name}.output`);
  writeFileSync(path, text);
  const at = NOW - minutesAgo * 60;
  utimesSync(path, at, at);
  return path;
}

function run(s: { dir: string; tasks: string }, ...extra: string[]) {
  return spawnSync(
    "python3",
    ["-I", script, "--session-dir", s.dir, "--tasks-dir", s.tasks, "--now", String(NOW), ...extra],
    { encoding: "utf-8" },
  );
}

describe("run-goal stalled-agents.py", () => {
  it("flags an unfinished worker silent past the limit, and only that one", () => {
    const s = session([
      ["aaa", false, 45],
      ["bbb", false, 5],
      ["ccc", true, 300],
    ]);
    const r = run(s, "--minutes", "20");
    expect(r.status).toBe(1);
    expect(r.stdout.trim().split("\n")).toEqual(["STALLED aaa 45m Ship aaa"]);
  });

  it("next to a stalled worker, lists a killed background shell but not an agent symlink", () => {
    const s = session([["aaa", false, 45]]);
    output(s, "shell1", "rc=0\n", 30);
    symlinkSync(output(s, "shell2", "\n[killed]\n", 30), join(s.tasks, "agentx.output"));
    const r = run(s);
    expect(r.status).toBe(1);
    expect(r.stdout.trim().split("\n")).toEqual(["STALLED aaa 45m Ship aaa", "KILLED shell2"]);
  });

  it("stays quiet about a killed shell when no worker is stalled (an expired Monitor)", () => {
    const s = session([["aaa", false, 2]]);
    output(s, "monitor1", "\n[killed]\n", 1);
    const r = run(s);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("lists only shells killed after the stalled worker last wrote, not older expired Monitors", () => {
    const s = session([["aaa", false, 45]]);
    output(s, "monitor-old", "\n[killed]\n", 120);
    output(s, "gate", "\n[killed]\n", 40);
    const r = run(s);
    expect(r.stdout.trim().split("\n")).toEqual(["STALLED aaa 45m Ship aaa", "KILLED gate"]);
  });

  it("does not flag a worker that was stopped on purpose", () => {
    const s = session([["aaa", false, 45, { stoppedByUser: true }]]);
    const r = run(s);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("exits 0 with no output when every worker is alive or finished", () => {
    const s = session([
      ["aaa", false, 3],
      ["bbb", true, 600],
    ]);
    const r = run(s);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("exits 2 when the session is not found", () => {
    const r = spawnSync("python3", ["-I", script, "--session", "no-such-session", "--projects", scratch], {
      encoding: "utf-8",
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("session not found");
  });
});
