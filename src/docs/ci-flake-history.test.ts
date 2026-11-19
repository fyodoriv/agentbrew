import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../scripts/gh-actions-flake-tracker.mjs", import.meta.url));
const sha = "a".repeat(40);

function runFixture(runs: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "agentbrew-flakes-"));
  try {
    const file = join(dir, "history.json");
    writeFileSync(file, JSON.stringify(runs));
    return spawnSync(process.execPath, [script, "--fixture", file], { encoding: "utf8", timeout: 5000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

type JobResult = "cancelled" | "failure" | "success";
function runHistory(id: number, conclusions: JobResult[], headSha = sha) {
  return {
    id,
    head_sha: headSha,
    run_attempt: conclusions.length,
    jobs: conclusions.map((conclusion, index) => ({
      run_id: id,
      head_sha: headSha,
      run_attempt: index + 1,
      name: "verify",
      status: "completed",
      conclusion,
    })),
  };
}

describe("hosted CI flake history", () => {
  it("reports the 10 percent boundary from ten comparable pairs", () => {
    const history = Array.from({ length: 10 }, (_, index) =>
      runHistory(index + 1, [index === 0 ? "failure" : "success", "success"]),
    );
    const result = runFixture(history);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      sampledRuns: 10,
      rerunRuns: 10,
      minimumPairs: 5,
      reportPercent: 10,
      jobs: [{ name: "verify", pairs: 10, failureThenSuccess: 1, eligible: true, reported: true }],
    });
  });

  it("keeps a four-pair sample below the reporting threshold", () => {
    const history = [1, 2, 3, 4].map((id) => runHistory(id, ["failure", "success"]));
    const result = runFixture(history);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).jobs).toEqual([
      { name: "verify", pairs: 4, failureThenSuccess: 4, eligible: false, reported: false },
    ]);
  });

  it("excludes cancelled and duplicate jobs without pairing different runs", () => {
    const duplicate = runHistory(2, ["failure", "success"]);
    duplicate.jobs.push({ ...duplicate.jobs[1], conclusion: "failure" });
    const result = runFixture([
      runHistory(1, ["failure", "cancelled", "success"]),
      duplicate,
      runHistory(3, ["failure"]),
      runHistory(4, ["success"]),
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).jobs).toEqual([
      { name: "verify", pairs: 0, failureThenSuccess: 0, eligible: false, reported: false },
    ]);
  });

  it("returns no report if an attempt is missing or the job SHA differs", () => {
    const missing = runHistory(1, ["failure", "success"]);
    missing.jobs.pop();
    const mismatched = runHistory(2, ["failure", "success"]);
    mismatched.jobs[1].head_sha = "b".repeat(40);

    for (const input of [[missing], [mismatched]]) {
      const result = runFixture(input);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("No CI flake report.");
    }
  });
});
