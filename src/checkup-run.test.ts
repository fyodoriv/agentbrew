import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";

interface CheckupRecord {
  finished_at: string;
  result: "green" | "degraded" | "blocked";
  commits: Readonly<Record<string, string>>;
}

interface RunReceipt {
  ordinal: 1 | 2;
  exit: number | null;
  assessmentCompleted: boolean;
  context: { beforeWork: boolean; value: "first-run" | CheckupRecord } | null;
  saved: CheckupRecord | "invalid" | null;
}

type ExpectedRuns = readonly [CheckupRecord] | readonly [CheckupRecord, CheckupRecord];

function classify(receipts: readonly RunReceipt[], expected: ExpectedRuns) {
  if (
    receipts.length !== expected.length ||
    receipts.some(
      (receipt, index) => receipt.ordinal !== index + 1 || receipt.exit === null || !receipt.assessmentCompleted,
    )
  ) {
    return { status: "inconclusive", completeRuns: null };
  }

  const completeRuns = receipts.filter((receipt, index) => {
    const previous = index === 0 ? "first-run" : receipts[index - 1].saved;
    return (
      receipt.exit === 0 &&
      receipt.context?.beforeWork === true &&
      isDeepStrictEqual(receipt.context.value, previous) &&
      isDeepStrictEqual(receipt.saved, expected[index])
    );
  }).length;

  return {
    status: completeRuns === expected.length ? "complete" : "feature-failure",
    completeRuns,
  };
}

const prior: CheckupRecord = {
  finished_at: "2026-01-01T01:00:00Z",
  result: "green",
  commits: { fixture: "abcdef0" },
};

const next: CheckupRecord = {
  finished_at: "2026-01-01T02:00:00Z",
  result: "green",
  commits: { fixture: "abcdef1" },
};

const first: RunReceipt = {
  ordinal: 1,
  exit: 0,
  assessmentCompleted: true,
  context: { beforeWork: true, value: "first-run" },
  saved: prior,
};

const second: RunReceipt = {
  ordinal: 2,
  exit: 0,
  assessmentCompleted: true,
  context: { beforeWork: true, value: prior },
  saved: next,
};

describe("checkup run record recorder calibration", () => {
  it("counts a complete first run", () => {
    expect(classify([first], [prior])).toEqual({ status: "complete", completeRuns: 1 });
  });

  it("records a finished assessment without context or saved state as a feature failure", () => {
    expect(classify([{ ...first, context: null, saved: null }], [prior])).toEqual({
      status: "feature-failure",
      completeRuns: 0,
    });
  });

  it("rejects context printed after work starts", () => {
    expect(classify([{ ...first, context: { beforeWork: false, value: "first-run" } }], [prior])).toEqual({
      status: "feature-failure",
      completeRuns: 0,
    });
  });

  it("records an observed malformed state as a feature failure", () => {
    expect(classify([{ ...first, saved: "invalid" }], [prior])).toEqual({
      status: "feature-failure",
      completeRuns: 0,
    });
  });

  it("counts both runs when the second displays the exact first completion", () => {
    expect(classify([first, second], [prior, next])).toEqual({ status: "complete", completeRuns: 2 });
  });

  it("rejects a second run that displays a different completion time", () => {
    const wrongTime = { ...prior, finished_at: next.finished_at };
    expect(classify([first, { ...second, context: { beforeWork: true, value: wrongTime } }], [prior, next])).toEqual({
      status: "feature-failure",
      completeRuns: 1,
    });
  });

  it("rejects a second run that displays different commits", () => {
    const wrongCommits = { ...prior, commits: next.commits };
    expect(classify([first, { ...second, context: { beforeWork: true, value: wrongCommits } }], [prior, next])).toEqual(
      {
        status: "feature-failure",
        completeRuns: 1,
      },
    );
  });

  it("keeps a missing second receipt inconclusive", () => {
    expect(classify([first], [prior, next])).toEqual({ status: "inconclusive", completeRuns: null });
  });

  it("keeps duplicate run receipts inconclusive", () => {
    expect(classify([first, first], [prior, next])).toEqual({ status: "inconclusive", completeRuns: null });
  });

  it("keeps a setup failure before assessment completion inconclusive", () => {
    const missingCommand = { ...first, exit: 127, assessmentCompleted: false, context: null, saved: null };
    expect(classify([missingCommand], [prior])).toEqual({ status: "inconclusive", completeRuns: null });
  });

  it("keeps a run with no observed exit inconclusive", () => {
    expect(classify([{ ...first, exit: null }], [prior])).toEqual({ status: "inconclusive", completeRuns: null });
  });

  it("records a nonzero exit after assessment completion as a feature failure", () => {
    expect(classify([{ ...first, exit: 1, saved: null }], [prior])).toEqual({
      status: "feature-failure",
      completeRuns: 0,
    });
  });
});

type Producer = "agentbrew" | "fixture-project";

function readSavedRecord(path: string): RunReceipt["saved"] {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!stat.isFile() || stat.size > 64 * 1024) return "invalid";

  const bytes = readFileSync(path, "utf8");
  let record: CheckupRecord | null;
  try {
    record = JSON.parse(bytes);
  } catch {
    return "invalid";
  }
  if (
    !record ||
    !isDeepStrictEqual(Object.keys(record).sort(), ["commits", "finished_at", "result"]) ||
    typeof record.finished_at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(record.finished_at) ||
    !Number.isFinite(Date.parse(record.finished_at)) ||
    !["green", "degraded", "blocked"].includes(record.result) ||
    !record.commits ||
    typeof record.commits !== "object" ||
    Array.isArray(record.commits) ||
    !Object.entries(record.commits).every(
      ([name, hash]) =>
        /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(name) && typeof hash === "string" && /^[0-9a-f]{7,64}$/u.test(hash),
    )
  ) {
    return "invalid";
  }
  return record;
}

function captureContext(output: string, workStart: number, previous: RunReceipt["saved"]): RunReceipt["context"] {
  if (workStart < 0) return null;
  const before = output.slice(0, workStart);
  if (/\b(?:first[- ]run|no (?:previous|completed) (?:checkup )?run)\b/iu.test(before)) {
    return { beforeWork: true, value: "first-run" };
  }
  if (!previous || previous === "invalid") return null;
  const timestamps = new Set(before.split(/[^a-zA-Z0-9:+_.-]+/u));
  const tokens = new Set(before.split(/[^a-zA-Z0-9_.-]+/u));
  if (
    timestamps.has(previous.finished_at) &&
    tokens.has(previous.result) &&
    Object.entries(previous.commits).every(([name, hash]) => tokens.has(name) && tokens.has(hash))
  ) {
    return { beforeWork: true, value: previous };
  }
  return null;
}

type CallerControl = "interrupt" | "degraded" | "refuse-healthy" | "refuse-degraded" | "missing-launcher";

function observeCheckup(producer: Producer, runTwice: boolean, control?: CallerControl) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "checkup-record-observation-"));
  const repo = join(root, producer);
  const home = join(root, "home");
  const bin = join(root, "bin");
  const temp = join(root, "tmp");
  const state = join(root, "state");
  const template = join(root, "git-template");
  const trace = join(root, "ports");
  const recorderTrace = join(root, "recorder-ports");
  const recordPath = join(state, "checkups", `${producer}.json`);
  const wrapUp = join(root, "wrap-up");
  const launcher = process.env.CHECKUP_RUN_TEST_CLI;
  function writeScript(path: string, script: string) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, script, { mode: 0o700 });
  }

  function port(label: string) {
    return `#!/bin/bash\nprintf '%s\\n' '${label}' >> "$CHECKUP_FIXTURE_TRACE"\n`;
  }

  const env = {
    HOME: home,
    TMPDIR: temp,
    XDG_STATE_HOME: state,
    PATH: `${bin}:${control === "missing-launcher" ? "/usr/bin:/bin" : (process.env.PATH ?? "/usr/bin:/bin")}`,
    LC_ALL: "C",
    TZ: "UTC",
    AGENTBREW_EVENTS: "0",
    NEW_PROJECT_SKILL: join(root, "no-audit-skill"),
    WRAP_UP_SKILL: wrapUp,
    CHECKUP_FIXTURE_TRACE: trace,
    CHECKUP_FIXTURE_RECORDER_TRACE: recorderTrace,
    CHECKUP_FIXTURE_NODE: process.execPath,
    CHECKUP_FIXTURE_LAUNCHER: launcher ?? "",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TEMPLATE_DIR: template,
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.com",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.com",
    GIT_TERMINAL_PROMPT: "0",
  };

  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: repo,
      env,
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

  try {
    for (const dir of [repo, home, bin, temp, state, template]) mkdirSync(dir);
    const isAgentbrew = producer === "agentbrew";
    const sources = isAgentbrew ? "scripts" : "skill-plugins/workflow/new-project/templates/scripts";
    const script = readFileSync(join(sources, "checkup.sh"), "utf8");
    writeScript(join(repo, "scripts/checkup.sh"), isAgentbrew ? script : script.replaceAll("{{NAME}}", producer));
    writeScript(join(repo, "scripts/report-html.sh"), readFileSync(join(sources, "report-html.sh"), "utf8"));
    writeScript(join(repo, "scripts/metrics.sh"), port("metrics"));
    const openWork = isAgentbrew ? join(repo, "skill-plugins/workflow/wrap-up") : wrapUp;
    writeScript(join(openWork, "scripts/open-work.sh"), port("open-work"));
    if (isAgentbrew) {
      writeScript(join(repo, "scripts/verify.sh"), port("gate") + "printf 'verify: passed fixture\\n'\n");
      writeScript(
        join(bin, "npx"),
        [
          "#!/bin/bash",
          "if [[ $# == 4 && $1 == tsx && $2 == src/cli.ts && $3 == status && $4 == --ci ]]; then",
          '  printf "%s\\n" doctor >> "$CHECKUP_FIXTURE_TRACE"',
          "  exit 0",
          "fi",
          'printf "%s\\n" unexpected:npx >> "$CHECKUP_FIXTURE_TRACE"',
          "exit 126",
          "",
        ].join("\n"),
      );
    } else {
      writeScript(join(repo, "scripts/doctor.sh"), port("doctor"));
      writeScript(join(repo, "scripts/check.sh"), port("gate"));
      writeScript(join(bin, "npx"), port("unexpected:npx") + "exit 126\n");
    }
    for (const name of ["gh", "npm", "ssh", "curl"]) {
      writeScript(join(bin, name), port(`unexpected:${name}`) + "exit 126\n");
    }
    if (control === "missing-launcher") {
      const discovery = spawnSync("/bin/bash", ["-c", "command -v agentbrew"], { cwd: repo, env, stdio: "ignore" });
      if (discovery.status !== 1) throw new Error("fixture missing launcher isolation");
    } else if (launcher !== undefined) {
      if (!launcher.startsWith("/") || !lstatSync(realpathSync(launcher)).isFile()) {
        throw new Error("fixture launcher prerequisite");
      }
      writeScript(
        join(bin, "agentbrew"),
        [
          "#!/bin/bash",
          'if [[ "$1" != checkup-run || ( "$2" != show && "$2" != record ) ]]; then',
          '  printf "%s\\n" unexpected:agentbrew >> "$CHECKUP_FIXTURE_TRACE"',
          "  exit 126",
          "fi",
          'printf "%s\\n" "$2" >> "$CHECKUP_FIXTURE_RECORDER_TRACE"',
          'exec "$CHECKUP_FIXTURE_NODE" "$CHECKUP_FIXTURE_LAUNCHER" "$@"',
          "",
        ].join("\n"),
      );
    } else {
      writeScript(join(bin, "agentbrew"), port("unexpected:agentbrew") + "exit 126\n");
    }
    writeFileSync(join(repo, "TASKS.md"), "## P0\n\n");
    git("init", "-q");

    function capture(ordinal: 1 | 2, previous: RunReceipt["saved"]) {
      git("commit", "--quiet", "--allow-empty", "-m", `fixture assessment ${ordinal}`);
      const head = git("rev-parse", "HEAD");
      writeFileSync(trace, "");
      if (launcher !== undefined) writeFileSync(recorderTrace, "");
      const report = join(repo, ".metrics/checkup.html");
      rmSync(report, { force: true });

      const began = Date.now();
      const run = spawnSync("/bin/bash", ["scripts/checkup.sh"], {
        cwd: repo,
        env,
        encoding: "utf8",
        timeout: 20_000,
        maxBuffer: 128 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const ended = Date.now();
      const output = run.stdout ?? "";
      const workStart = output.indexOf(isAgentbrew ? "## 0. Open work" : "== Open work");
      const ports = readFileSync(trace, "utf8").trim().split("\n");
      const reportExists = existsSync(report);
      const assessmentCompleted =
        !run.error &&
        !run.signal &&
        ended >= began &&
        workStart >= 0 &&
        /^checkup: healthy$/mu.test(output) &&
        reportExists &&
        isDeepStrictEqual(ports, ["open-work", "doctor", "gate", "metrics"]);

      const saved = readSavedRecord(recordPath);
      const record = saved && saved !== "invalid" ? saved : null;
      const observedTime = record ? Date.parse(record.finished_at) : Number.NaN;
      const observedCommit = record?.commits[producer];
      const expected: CheckupRecord = {
        finished_at:
          record && observedTime >= Math.floor(began / 1000) * 1000 && observedTime <= ended
            ? record.finished_at
            : new Date(began).toISOString(),
        result: "green",
        commits: { [producer]: observedCommit && head.startsWith(observedCommit) ? observedCommit : head },
      };
      const receipt: RunReceipt = {
        ordinal,
        exit: run.status,
        assessmentCompleted,
        context: captureContext(output, workStart, previous),
        saved,
      };
      return {
        receipt,
        expected,
        evidence: {
          ports,
          reportExists,
          workStart,
          ...(launcher === undefined
            ? {}
            : {
                recorderPorts: readFileSync(recorderTrace, "utf8").trim().split("\n").filter(Boolean),
              }),
          spawnError: Boolean(run.error),
          signal: run.signal,
          stdout: output.replaceAll(root, "<scratch>"),
          stderr: (run.stderr ?? "").replaceAll(root, "<scratch>"),
        },
      };
    }

    if (control !== undefined) {
      const gate = join(repo, isAgentbrew ? "scripts/verify.sh" : "scripts/check.sh");
      const failedGate = control === "degraded" || control === "refuse-degraded";
      if (failedGate) writeScript(gate, port("gate") + "exit 1\n");
      if (control === "interrupt") {
        const first = capture(1, null);
        if (classify([first.receipt], [first.expected]).status !== "complete") {
          throw new Error("fixture prior assessment incomplete");
        }
        const previousBytes = readFileSync(recordPath);
        writeScript(gate, port("gate") + 'kill -TERM "$PPID"\n');
        const attempt = capture(2, first.receipt.saved);
        return { attempts: [attempt], previousPreserved: previousBytes.equals(readFileSync(recordPath)) };
      }
      if (control === "refuse-healthy" || control === "refuse-degraded") {
        if (launcher === undefined) throw new Error("fixture launcher prerequisite");
        execFileSync(
          process.execPath,
          [launcher, "checkup-run", "record", producer, "--finished-at", "2099-01-01T00:00:00Z", "--result", "blocked"],
          { cwd: repo, env, timeout: 10_000, stdio: "ignore" },
        );
        const previousBytes = readFileSync(recordPath);
        const attempt = capture(1, readSavedRecord(recordPath));
        return { attempts: [attempt], previousPreserved: previousBytes.equals(readFileSync(recordPath)) };
      }
      return { attempts: [capture(1, null)] };
    }

    const one = capture(1, null);
    const two = runTwice ? capture(2, one.receipt.saved) : null;
    const result = two
      ? classify([one.receipt, two.receipt], [one.expected, two.expected])
      : classify([one.receipt], [one.expected]);
    return { result, attempts: two ? [one, two] : [one] };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe.runIf(process.env.CHECKUP_RUN_OBSERVATION === "1")("checkup run record", () => {
  it.each([
    { id: "C01", producer: "agentbrew", twice: false },
    { id: "C02", producer: "agentbrew", twice: true },
    { id: "C03", producer: "fixture-project", twice: false },
    { id: "C04", producer: "fixture-project", twice: true },
  ] as const)("$id captures $producer completed assessment state", ({ id, producer, twice }) => {
    let observation: ReturnType<typeof observeCheckup>;
    try {
      observation = observeCheckup(producer, twice);
    } catch {
      console.info(
        `CHECKUP_RUN_OBSERVATION ${JSON.stringify({ id, producer, status: "inconclusive", reason: "fixture-setup" })}`,
      );
      throw new Error(`${id} fixture setup did not yield an observation`);
    }
    if (!("result" in observation) || observation.result === undefined) throw new Error("fixture receipt shape");
    console.info(`CHECKUP_RUN_OBSERVATION ${JSON.stringify({ id, producer, ...observation })}`);
    expect(observation.result.status, `${id} observation setup`).not.toBe("inconclusive");
    if (process.env.CHECKUP_RUN_REQUIRE_FEATURE === "1") {
      expect(observation.result, `${id} generic record contract`).toEqual({
        status: "complete",
        completeRuns: twice ? 2 : 1,
      });
    }
  }, 60_000);
});

describe.runIf(process.env.CHECKUP_RUN_OBSERVATION === "1" && process.env.CHECKUP_RUN_TEST_CLI !== undefined)(
  "checkup run record caller controls",
  () => {
    it.each([
      "agentbrew",
      "fixture-project",
    ] as const)("C05 %s preserves its prior record on interruption", (producer) => {
      const observed = observeCheckup(producer, false, "interrupt");
      const [attempt] = observed.attempts;
      expect(attempt.evidence).toMatchObject({
        ports: ["open-work", "doctor", "gate"],
        reportExists: false,
        recorderPorts: ["show"],
        spawnError: false,
        signal: "SIGTERM",
      });
      expect(observed.previousPreserved).toBe(true);
    }, 60_000);

    it.each(["agentbrew", "fixture-project"] as const)("C06 %s records degradation and reports refusal", (producer) => {
      const {
        attempts: [degraded],
      } = observeCheckup(producer, false, "degraded");
      expect(degraded.evidence).toMatchObject({
        ports: ["open-work", "doctor", "gate", "metrics"],
        recorderPorts: ["show", "record"],
        reportExists: true,
        spawnError: false,
        signal: null,
      });
      expect(degraded.receipt.exit).toBe(1);
      expect(degraded.receipt.saved).toEqual({ ...degraded.expected, result: "degraded" });

      for (const control of ["refuse-healthy", "refuse-degraded"] as const) {
        const observed = observeCheckup(producer, false, control);
        const [attempt] = observed.attempts;
        expect(attempt.evidence).toMatchObject({
          ports: ["open-work", "doctor", "gate", "metrics"],
          recorderPorts: ["show", "record"],
          reportExists: true,
          spawnError: false,
          signal: null,
        });
        expect(attempt.evidence.stdout).toContain("checkup record: incomplete");
        expect(attempt.evidence.stdout).not.toContain("checkup: healthy");
        expect(attempt.receipt.exit).toBe(control === "refuse-healthy" ? 2 : 1);
        expect(attempt.receipt.saved).toMatchObject({ result: "blocked" });
        expect(observed.previousPreserved).toBe(true);
      }
    }, 60_000);

    it("C10 generated project keeps working without the optional launcher", () => {
      const {
        attempts: [attempt],
      } = observeCheckup("fixture-project", false, "missing-launcher");
      expect(attempt.receipt).toMatchObject({ assessmentCompleted: true, exit: 0, saved: null });
      expect(attempt.evidence.stdout).toContain("checkup record: unavailable");
      expect(attempt.evidence.stdout).not.toContain("Recorded completed checkup");
    }, 60_000);
  },
);
