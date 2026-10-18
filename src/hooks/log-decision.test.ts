import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const LIB = join(import.meta.dirname, "..", "..", "hooks", "lib", "log-decision.sh");
const roots: string[] = [];

function run(env: Record<string, string>, input = ""): void {
  execFileSync("bash", ["-c", `source "${LIB}"; INPUT="$1"; log_decision demo-hook block "why"`, "_", input], {
    env: { PATH: process.env.PATH ?? "", ...env },
  });
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "log-decision-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("hooks/lib/log-decision.sh", () => {
  it("writes to HOOK_DECISIONS_LOG instead of HOME when set", () => {
    const home = tempDir();
    const log = join(tempDir(), "decisions.jsonl");
    run({ HOME: home, HOOK_DECISIONS_LOG: log });
    expect(existsSync(join(home, ".cache", "agentbrew", "hook-decisions.jsonl"))).toBe(false);
    expect(JSON.parse(readFileSync(log, "utf8"))).toMatchObject({ hookId: "demo-hook", decision: "block" });
  });

  it("tags the row with session_id from the hook INPUT", () => {
    const log = join(tempDir(), "decisions.jsonl");
    run({ HOME: tempDir(), HOOK_DECISIONS_LOG: log }, JSON.stringify({ session_id: "abc-123", tool_name: "Edit" }));
    expect(JSON.parse(readFileSync(log, "utf8")).sessionId).toBe("abc-123");
  });

  it("omits sessionId when the input has none (fixture runs)", () => {
    const log = join(tempDir(), "decisions.jsonl");
    run({ HOME: tempDir(), HOOK_DECISIONS_LOG: log }, JSON.stringify({ tool_name: "Edit" }));
    expect(JSON.parse(readFileSync(log, "utf8"))).not.toHaveProperty("sessionId");
  });
});
