import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MAX_RUNS = 100;
const MIN_PAIRS = 5;
const REPORT_PERCENT = 10;

function githubList(endpoint, paginate = false) {
  try {
    const pagination = paginate ? ["--paginate", "--slurp"] : [];
    const output = execFileSync("gh", ["api", ...pagination, endpoint], {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const parsed = JSON.parse(output);
    return paginate ? parsed : [parsed];
  } catch {
    throw new Error("Unable to read the GitHub Actions history.");
  }
}

function readGitHubRuns(repository) {
  const root = `repos/${repository}/actions`;
  const pages = githubList(`${root}/workflows/ci.yml/runs?status=completed&per_page=${MAX_RUNS}`);
  const runs = pages.flatMap((page) => page.workflow_runs).slice(0, MAX_RUNS);
  return runs.map((run) => {
    const jobs =
      run?.run_attempt > 1 && Number.isSafeInteger(run.id)
        ? githubList(`${root}/runs/${run.id}/jobs?filter=all&per_page=100`, true).flatMap((page) => page.jobs)
        : [];
    return { id: run?.id, head_sha: run?.head_sha, run_attempt: run?.run_attempt, jobs };
  });
}

function jobAttempts(run) {
  const jobs = new Map();
  const observedAttempts = new Set();
  for (const job of run.jobs) {
    if (
      job?.run_id !== run.id ||
      job.head_sha !== run.head_sha ||
      typeof job.name !== "string" ||
      !job.name ||
      !Number.isSafeInteger(job.run_attempt) ||
      job.run_attempt < 1 ||
      job.run_attempt > run.run_attempt
    ) {
      throw new Error("Run history contains a job with an unverified run, SHA, name or attempt.");
    }

    observedAttempts.add(job.run_attempt);
    const attempts = jobs.get(job.name) ?? new Map();
    const comparable = job.status === "completed" && (job.conclusion === "failure" || job.conclusion === "success");
    attempts.set(job.run_attempt, comparable && !attempts.has(job.run_attempt) ? job.conclusion : null);
    jobs.set(job.name, attempts);
  }

  if (observedAttempts.size !== run.run_attempt) {
    throw new Error("Run history is missing one or more attempts.");
  }
  return jobs;
}

function countPairs(job, attempts) {
  const outcomes = [...attempts.entries()].sort(([first], [second]) => first - second);
  for (let index = 1; index < outcomes.length; index++) {
    const previous = outcomes[index - 1][1];
    const current = outcomes[index][1];
    if (previous === null || current === null) continue;
    job.pairs++;
    if (previous === "failure" && current === "success") job.failureThenSuccess++;
  }
}

function checkRun(run, seen) {
  if (
    !Number.isSafeInteger(run?.id) ||
    run.id < 1 ||
    seen.has(run.id) ||
    typeof run.head_sha !== "string" ||
    !/^[0-9a-f]{40}$/.test(run.head_sha) ||
    !Number.isSafeInteger(run.run_attempt) ||
    run.run_attempt < 1 ||
    !Array.isArray(run.jobs)
  ) {
    throw new Error("Run history is missing a unique ID, a source SHA or attempt data.");
  }
}

function summarizeRuns(runs) {
  if (!Array.isArray(runs) || runs.length > MAX_RUNS) {
    throw new Error("Expected an array of at most 100 completed CI runs.");
  }

  const seen = new Set();
  const totals = new Map();
  let rerunRuns = 0;
  for (const run of runs) {
    checkRun(run, seen);
    seen.add(run.id);
    if (run.run_attempt === 1) continue;
    rerunRuns++;

    for (const [name, attempts] of jobAttempts(run)) {
      const job = totals.get(name) ?? { name, pairs: 0, failureThenSuccess: 0 };
      countPairs(job, attempts);
      totals.set(name, job);
    }
  }

  const jobs = [...totals.values()]
    .sort((first, second) => first.name.localeCompare(second.name))
    .map((job) => ({
      ...job,
      eligible: job.pairs >= MIN_PAIRS,
      reported: job.pairs >= MIN_PAIRS && 100 * job.failureThenSuccess >= REPORT_PERCENT * job.pairs,
    }));
  return { sampledRuns: runs.length, rerunRuns, minimumPairs: MIN_PAIRS, reportPercent: REPORT_PERCENT, jobs };
}

function main(args) {
  if (args.length === 2 && args[0] === "--fixture") {
    return summarizeRuns(JSON.parse(readFileSync(args[1], "utf8")));
  }
  if (args.length === 2 && args[0] === "--repo" && /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(args[1])) {
    return summarizeRuns(readGitHubRuns(args[1]));
  }
  throw new Error("Usage: gh-actions-flake-tracker.mjs --repo OWNER/REPO or --fixture FILE");
}

try {
  console.log(JSON.stringify(main(process.argv.slice(2)), null, 2));
} catch (error) {
  console.error(`No CI flake report. ${error.message}`);
  process.exitCode = 1;
}
