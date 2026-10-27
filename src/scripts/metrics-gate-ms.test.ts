import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = resolve(import.meta.dirname, "..", "..", "scripts", "metrics.sh");

function gateMs(lines: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), "gate-ms-"));
  const file = join(dir, "gate-timings.jsonl");
  writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  const r = spawnSync("bash", [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, AGENTBREW_GATE_TIMINGS: file, AGENTBREW_EVENTS_FILE: join(dir, "none.jsonl") },
  });
  return r.stdout.match(/^gate_ms\s+(\S+)/m)?.[1] ?? "";
}

describe("metrics.sh gate_ms", () => {
  it("counts a cached step at its last uncached time, so cached gates stay in the sample", () => {
    expect(
      gateMs([
        { ts: "a", event: "step", step: "test-all", ms: 300, ok: true, cached: false },
        { ts: "a", event: "gate", mode: "full", ms: 400, ok: true, cached_steps: 0 },
        { ts: "b", event: "step", step: "test-all", ms: 1, ok: true, cached: true },
        { ts: "b", event: "gate", mode: "full", ms: 201, ok: true, cached_steps: 1 },
        { ts: "c", event: "step", step: "test-all", ms: 1, ok: true, cached: true },
        { ts: "c", event: "gate", mode: "full", ms: 221, ok: true, cached_steps: 1 },
      ]),
    ).toBe("500");
  });

  it("leaves out a gate whose cached step was never timed uncached", () => {
    expect(
      gateMs([
        { ts: "b", event: "step", step: "hooks", ms: 1, ok: true, cached: true },
        { ts: "b", event: "gate", mode: "full", ms: 50, ok: true, cached_steps: 1 },
      ]),
    ).toBe("(stub)");
  });
});
