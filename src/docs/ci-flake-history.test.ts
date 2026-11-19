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

function runApiFixture(runsPage: unknown, jobsPages: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "agentbrew-flake-api-"));
  try {
    writeFileSync(join(dir, "runs.json"), JSON.stringify(runsPage));
    writeFileSync(join(dir, "jobs.json"), JSON.stringify(jobsPages));
    writeFileSync(
      join(dir, "gh"),
      [
        "#!/bin/sh",
        'case "$*" in',
        '  "api repos/example/repo/actions/workflows/ci.yml/runs?status=completed&per_page=100") cat "$CI_FIXTURE_DIR/runs.json" ;;',
        '  "api --paginate --slurp repos/example/repo/actions/runs/1/jobs?filter=all&per_page=100") cat "$CI_FIXTURE_DIR/jobs.json" ;;',
        "  *) exit 1 ;;",
        "esac",
        "",
      ].join("\n"),
      { mode: 0o700 },
    );
    return spawnSync(process.execPath, [script, "--repo", "example/repo"], {
      encoding: "utf8",
      timeout: 5000,
      env: { ...process.env, PATH: [dir, process.env.PATH].join(":"), CI_FIXTURE_DIR: dir },
    });
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
      id: id * 100 + index,
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
    duplicate.jobs.push({ ...duplicate.jobs[1], id: 204, conclusion: "failure" });
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

  it("accepts complete API pages and rejects truncated or duplicate history", () => {
    const run = runHistory(1, ["failure", "success"]);
    const runsPage = { total_count: 1, workflow_runs: [run] };
    const pages = run.jobs.map((job) => ({ total_count: 2, jobs: [job] }));
    const result = runApiFixture(runsPage, pages);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).jobs[0]).toMatchObject({ pairs: 1, failureThenSuccess: 1 });

    const missingRun = runApiFixture({ ...runsPage, total_count: 2 }, pages);
    const missingJob = runApiFixture(runsPage, [{ total_count: 3, jobs: run.jobs }]);
    const duplicateJob = runApiFixture(runsPage, [pages[0], pages[0]]);
    for (const bad of [missingRun, missingJob, duplicateJob]) {
      expect(bad.status).toBe(1);
      expect(bad.stdout).toBe("");
      expect(bad.stderr).toContain("No CI flake report.");
    }
  });
});
