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

/** A session folder with one agent per entry: [id, finished, minutes silent]. */
function session(agents: [string, boolean, number][]): { dir: string; tasks: string } {
  const dir = mkdtempSync(join(scratch, "session-"));
  const sub = join(dir, "subagents");
  const tasks = join(dir, "tasks");
  mkdirSync(sub, { recursive: true });
  mkdirSync(tasks, { recursive: true });
  for (const [id, finished, silent] of agents) {
    const meta = { description: `Ship ${id}`, ...(finished ? { finished: true } : {}) };
    writeFileSync(join(sub, `agent-${id}.meta.json`), JSON.stringify(meta));
    const transcript = join(sub, `agent-${id}.jsonl`);
    writeFileSync(transcript, "{}\n");
    const at = NOW - silent * 60;
    utimesSync(transcript, at, at);
  }
  return { dir, tasks };
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
    writeFileSync(join(s.tasks, "shell1.output"), "rc=0\n");
    writeFileSync(join(s.tasks, "shell2.output"), "\n[killed]\n");
    symlinkSync(join(s.tasks, "shell2.output"), join(s.tasks, "agentx.output"));
    const r = run(s);
    expect(r.status).toBe(1);
    expect(r.stdout.trim().split("\n")).toEqual(["STALLED aaa 45m Ship aaa", "KILLED shell2"]);
  });

  it("stays quiet about a killed shell when no worker is stalled (an expired Monitor)", () => {
    const s = session([["aaa", false, 2]]);
    writeFileSync(join(s.tasks, "monitor1.output"), "\n[killed]\n");
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
