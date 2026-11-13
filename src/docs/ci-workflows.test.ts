import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

// Pins the safety contract of the hosted workflows (docs/ci.md): a public
// repo runs code from strangers' pull requests, so each rule here closes one
// way a workflow could leak a token or run with more rights than it needs.
const workflowsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".github", "workflows");
const workflows = readdirSync(workflowsDir)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({ name, text: readFileSync(join(workflowsDir, name), "utf8") }));

/** Lines that are not YAML comments. */
function codeLines(text: string): string[] {
  return text.split("\n").filter((line) => !line.trim().startsWith("#"));
}

describe("hosted workflows", () => {
  it("finds the workflows", () => {
    expect(workflows.map((w) => w.name)).toContain("ci.yml");
  });

  it.each(workflows)("$name pins every action to a full commit SHA", ({ text }) => {
    const uses = codeLines(text).filter((line) => /^\s*(-\s*)?uses:/.test(line));
    for (const line of uses) {
      // Only GitHub-owned actions, each at a full commit SHA.
      expect(line).toMatch(/uses:\s*(actions|github)\/[\w./-]+@[0-9a-f]{40}\s+#\s*v\d/);
    }
  });

  it.each(workflows)("$name sets top-level permissions", ({ text }) => {
    expect(codeLines(text).some((line) => /^permissions:/.test(line))).toBe(true);
  });

  it.each(workflows)("$name never runs fork code with repo rights or secrets", ({ text }) => {
    const code = codeLines(text).join("\n");
    expect(code).not.toMatch(/pull_request_target|workflow_run|issue_comment/);
    // Event text (a PR title, a branch name) may steer a job, never a script.
    const eventLines = codeLines(text).filter((line) => line.includes("github.event."));
    for (const line of eventLines) {
      expect(line.trim()).toMatch(/^(if|group|cancel-in-progress):/);
    }
    expect(code).not.toMatch(/\$\{\{\s*secrets\./);
    // A step that prints the environment could expose values in a public log.
    expect(code).not.toMatch(/^\s*(-\s*)?run:\s*(env|printenv|set)\s*$/m);
  });

  it("only the release workflow may write to the repository", () => {
    for (const { name, text } of workflows) {
      if (name === "auto-publish.yml") continue;
      expect(codeLines(text).join("\n"), name).not.toMatch(/:\s*write\b/);
    }
  });

  it("every workflow starts only from its allowed triggers", () => {
    // A new trigger is a decision: add it here in the same change.
    const allowed: Record<string, string[]> = {
      "auto-publish.yml": ["workflow_dispatch"],
      "ci.yml": ["pull_request", "push", "workflow_dispatch"],
      "oss-readiness.yml": ["pull_request", "push", "workflow_dispatch"],
      "pr-vision-trace.yml": ["workflow_dispatch"],
      "publish.yml": ["push"],
    };
    for (const { name, text } of workflows) {
      const code = codeLines(text).join("\n");
      const on = code.match(/^on:\n((?:[ \t]+.*\n|\n)*)/m)?.[1] ?? "";
      const keys = on
        .split("\n")
        .filter((line) => /^ {2}\S/.test(line))
        .map((line) => line.trim().replace(/:.*$/, ""));
      expect(keys, name).toEqual(allowed[name] ?? []);
    }
  });

  it("the release workflow bumps the version on main only", () => {
    const text = workflows.find((w) => w.name === "auto-publish.yml")?.text ?? "";
    expect(text).toMatch(/if: github\.ref == 'refs\/heads\/main'/);
  });

  it.each(workflows)("$name gives every job a time limit", ({ text }) => {
    const jobs = codeLines(text).filter((line) => /^\s+runs-on:/.test(line)).length;
    const limits = codeLines(text).filter((line) => /^\s+timeout-minutes:/.test(line)).length;
    expect(limits).toBe(jobs);
  });

  it("limits hosted inventory controls to the pure receipt target", () => {
    const text = workflows.find((w) => w.name === "ci.yml")?.text ?? "";
    const document = load(text) as {
      permissions: { contents: string };
      env: Record<string, string>;
      defaults?: unknown;
      jobs: Record<
        string,
        {
          "runs-on": string;
          "timeout-minutes": number;
          strategy: { "fail-fast": boolean; matrix: { os: string[] } };
          steps: Array<Record<string, unknown>>;
        }
      >;
    };
    const safe = (input: typeof document): boolean => {
      const job = input.jobs["inventory-receipt"];
      if (!job || JSON.stringify(input.permissions) !== JSON.stringify({ contents: "read" })) return false;
      if (JSON.stringify(input.env) !== JSON.stringify({ DO_NOT_TRACK: "1", AGENTBREW_EVENTS: "0" })) return false;
      if (input.defaults !== undefined || job["runs-on"] !== "${{ matrix.os }}") return false;
      if (job["timeout-minutes"] !== 30 || job.strategy["fail-fast"] !== false) return false;
      const keys = (value: object) => Object.keys(value).sort().join(",");
      if (keys(job) !== "name,runs-on,steps,strategy,timeout-minutes") return false;
      if (keys(job.strategy) !== "fail-fast,matrix" || keys(job.strategy.matrix) !== "os") return false;
      if (JSON.stringify(job.strategy.matrix.os) !== JSON.stringify(["ubuntu-24.04", "macos-latest"])) return false;
      const steps = job.steps;
      if (steps.map(keys).join("|") !== "uses,with|name,run|name,run|name,run,shell") return false;
      if (steps.length !== 4 || steps[0].uses !== "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1")
        return false;
      if (JSON.stringify(steps[0].with) !== JSON.stringify({ "persist-credentials": false })) return false;
      if (steps[1].run !== "rustup toolchain install 1.97.0 --profile minimal") return false;
      if (steps[2].run !== "cargo +1.97.0 fetch --locked --manifest-path rust/Cargo.toml") return false;
      if (steps[3].shell !== "bash" || typeof steps[3].run !== "string") return false;
      const commands = steps[3].run
        .trim()
        .split("\n")
        .map((line) => line.trim());
      return (
        JSON.stringify(commands) ===
        JSON.stringify([
          "set -euo pipefail",
          'log="$RUNNER_TEMP/inventory-receipt-tests.log"',
          'cargo +1.97.0 test --locked --offline --manifest-path rust/Cargo.toml --test owner_success_receipt -- --test-threads=1 2>&1 | tee "$log"',
          "names='complete_record_accepted missing_field_refused unknown_terminal_unqualified unknown_reservation_unqualified unknown_ownership_unqualified invalid_enum_refused private_fields_refused cleanup_outcome_unchanged eperm_success_conflict_unqualified'",
          "for name in $names; do",
          '[ "$(grep -Ec "^test $name \\.\\.\\. ok$" "$log")" -eq 1 ]',
          "done",
          "grep -Eq '^test result: ok\\. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out' \"$log\"",
        ])
      );
    };
    expect(safe(document)).toBe(true);
    const extra = structuredClone(document);
    extra.jobs["inventory-receipt"].steps.push({ run: "cargo test --all-targets" });
    expect(safe(extra)).toBe(false);
    const target = structuredClone(document);
    target.jobs["inventory-receipt"].steps[3].run = "cargo run --bin lifecycle-fixture";
    expect(safe(target)).toBe(false);
    const credentials = structuredClone(document);
    credentials.jobs["inventory-receipt"].steps[0].with = { "persist-credentials": true };
    expect(safe(credentials)).toBe(false);
    const matrix = structuredClone(document);
    matrix.jobs["inventory-receipt"].strategy.matrix.os = ["ubuntu-24.04"];
    expect(safe(matrix)).toBe(false);
    const runner = structuredClone(document);
    runner.jobs["inventory-receipt"]["runs-on"] = "ubuntu-24.04";
    expect(safe(runner)).toBe(false);
    const injectedEnv = structuredClone(document);
    injectedEnv.env.BASH_ENV = "/tmp/untrusted";
    expect(safe(injectedEnv)).toBe(false);
    const defaults = structuredClone(document);
    defaults.defaults = { run: { shell: "untrusted" } };
    expect(safe(defaults)).toBe(false);
    const ignoredFailure = structuredClone(document);
    ignoredFailure.jobs["inventory-receipt"].steps[3]["continue-on-error"] = true;
    expect(safe(ignoredFailure)).toBe(false);
    const skipped = structuredClone(document);
    skipped.jobs["inventory-receipt"].steps[3].if = "false";
    expect(safe(skipped)).toBe(false);
  });

  it("keeps the hosted signal guard compile-only and isolated", () => {
    const text = workflows.find((w) => w.name === "ci.yml")?.text ?? "";
    const document = load(text) as {
      permissions: Record<string, string>;
      env: Record<string, string>;
      defaults?: unknown;
      jobs: Record<
        string,
        {
          "runs-on": string;
          "timeout-minutes": number;
          steps: Array<Record<string, unknown>>;
        }
      >;
    };
    const safe = (input: typeof document): boolean => {
      const job = input.jobs["inventory-guard-compile"];
      const keys = (value: object) => Object.keys(value).sort().join(",");
      const hash = (value: unknown) =>
        typeof value === "string" ? createHash("sha256").update(value).digest("hex") : "";
      if (!job || keys(job) !== "name,runs-on,steps,timeout-minutes") return false;
      if (JSON.stringify(input.permissions) !== JSON.stringify({ contents: "read" }) || input.defaults !== undefined)
        return false;
      if (JSON.stringify(input.env) !== JSON.stringify({ DO_NOT_TRACK: "1", AGENTBREW_EVENTS: "0" })) return false;
      if (job["runs-on"] !== "macos-latest" || job["timeout-minutes"] !== 30) return false;
      const steps = job.steps;
      if (steps.length !== 4 || steps.map(keys).join("|") !== "uses,with|name,run|name,run|name,run,shell")
        return false;
      if (steps[0].uses !== "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1") return false;
      if (JSON.stringify(steps[0].with) !== JSON.stringify({ "persist-credentials": false })) return false;
      if (steps[1].run !== "rustup toolchain install 1.97.0 --profile minimal" || steps[3].shell !== "bash")
        return false;
      return (
        hash(steps[2].run) === "ad73e8930d5592b65a482b3495f86eda76a3a70851ce8a6c7f377443e436bb00" &&
        hash(steps[3].run) === "00376265f2f2385bdd5d0570eb8a22fa82a542685560d49a3d97585a906b4b11"
      );
    };
    expect(safe(document)).toBe(true);
    const runner = structuredClone(document);
    runner.jobs["inventory-guard-compile"]["runs-on"] = "self-hosted";
    expect(safe(runner)).toBe(false);
    const credentials = structuredClone(document);
    credentials.jobs["inventory-guard-compile"].steps[0].with = {
      "persist-credentials": true,
    };
    expect(safe(credentials)).toBe(false);
    const target = structuredClone(document);
    target.jobs["inventory-guard-compile"].steps[3].run = "cargo run --bin lifecycle-fixture";
    expect(safe(target)).toBe(false);
    const environment = structuredClone(document);
    environment.env.RUSTFLAGS = "--cfg owner_hosted_experiment";
    expect(safe(environment)).toBe(false);
    const privileges = structuredClone(document);
    privileges.permissions.contents = "write";
    expect(safe(privileges)).toBe(false);
    const extra = structuredClone(document);
    extra.jobs["inventory-guard-compile"].steps.push({ run: "true" });
    expect(safe(extra)).toBe(false);
  });

  it("keeps the source-count experiment manual, pinned and isolated", () => {
    const text = workflows.find((w) => w.name === "ci.yml")?.text ?? "";
    const document = load(text) as {
      on: { workflow_dispatch: { inputs: Record<string, Record<string, unknown>> } };
      permissions: Record<string, string>;
      env: Record<string, string>;
      defaults?: unknown;
      concurrency: Record<string, unknown>;
      jobs: Record<
        string,
        { if: string; "runs-on": string; "timeout-minutes": number; steps: Array<Record<string, unknown>> }
      >;
    };
    const safe = (input: typeof document): boolean => {
      const job = input.jobs["inventory-n02b-experiment"];
      const inputs = input.on.workflow_dispatch?.inputs;
      const keys = (value: object) => Object.keys(value).sort().join(",");
      const hash = (value: unknown) =>
        typeof value === "string" ? createHash("sha256").update(value).digest("hex") : "";
      if (!job || !inputs || keys(inputs) !== "expected_sha,run_n02b") return false;
      if (
        JSON.stringify(inputs.run_n02b) !==
        JSON.stringify({
          description: "Run the reviewed synthetic source-count experiment",
          type: "boolean",
          default: false,
        })
      )
        return false;
      if (
        JSON.stringify(inputs.expected_sha) !==
        JSON.stringify({
          description: "Full reviewed commit SHA for the experiment",
          type: "string",
          required: false,
          default: "",
        })
      )
        return false;
      if (JSON.stringify(input.permissions) !== JSON.stringify({ contents: "read" }) || input.defaults !== undefined)
        return false;
      if (JSON.stringify(input.env) !== JSON.stringify({ DO_NOT_TRACK: "1", AGENTBREW_EVENTS: "0" })) return false;
      if (
        input.concurrency.group !==
        "ci-${{ github.event_name == 'workflow_dispatch' && format('manual-{0}', github.run_id) || github.event.pull_request.number || github.ref }}"
      )
        return false;
      if (input.concurrency["cancel-in-progress"] !== "${{ github.event_name == 'pull_request' }}") return false;
      if (
        keys(job) !== "if,name,runs-on,steps,timeout-minutes" ||
        job.if !== "${{ github.event_name == 'workflow_dispatch' && inputs.run_n02b == true }}"
      )
        return false;
      if (job["runs-on"] !== "ubuntu-24.04" || job["timeout-minutes"] !== 30) return false;
      const steps = job.steps;
      if (
        steps.length !== 5 ||
        steps.map(keys).join("|") !== "uses,with|env,name,run,shell|name,run|name,run|name,run,shell"
      )
        return false;
      if (
        steps[0].uses !== "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1" ||
        JSON.stringify(steps[0].with) !== JSON.stringify({ "persist-credentials": false })
      )
        return false;
      if (
        steps[1].shell !== "bash" ||
        JSON.stringify(steps[1].env) !== JSON.stringify({ EXPECTED_SHA: "${{ inputs.expected_sha }}" })
      )
        return false;
      if (steps[2].run !== "rustup toolchain install 1.97.0 --profile minimal" || steps[4].shell !== "bash")
        return false;
      return (
        hash(steps[1].run) === "bddd38c0403673d18e56a385c8ca8a9b0f92a82d41bcaa3e8b4482c80db87f61" &&
        hash(steps[3].run) === "898a4653b346b0d087a638a2cb25a20513123780e010517cc357e9622b5014d3" &&
        hash(steps[4].run) === "9df492e5732c2dd55df9551e745c0aec862e89c8775c4e22e67e5a43582e249f"
      );
    };
    expect(safe(document)).toBe(true);
    const enabled = structuredClone(document);
    enabled.on.workflow_dispatch.inputs.run_n02b.default = true;
    expect(safe(enabled)).toBe(false);
    const omitted = structuredClone(document);
    delete omitted.on.workflow_dispatch.inputs.run_n02b;
    expect(safe(omitted)).toBe(false);
    for (const trigger of ["push", "pull_request", "inputs.run_n02b"]) {
      const changed = structuredClone(document);
      changed.jobs["inventory-n02b-experiment"].if = trigger;
      expect(safe(changed)).toBe(false);
    }
    const runner = structuredClone(document);
    runner.jobs["inventory-n02b-experiment"]["runs-on"] = "self-hosted";
    expect(safe(runner)).toBe(false);
    const credentials = structuredClone(document);
    credentials.jobs["inventory-n02b-experiment"].steps[0].with = { "persist-credentials": true };
    expect(safe(credentials)).toBe(false);
    const privileges = structuredClone(document);
    privileges.permissions.contents = "write";
    expect(safe(privileges)).toBe(false);
    const target = structuredClone(document);
    target.jobs["inventory-n02b-experiment"].steps[4].run = "cargo run --bin owner-hosted-fixture";
    expect(safe(target)).toBe(false);
    const concurrency = structuredClone(document);
    concurrency.concurrency.group = "ci-${{ github.ref }}";
    expect(safe(concurrency)).toBe(false);
  });

  it("ci.yml runs the same gate as a local checkout", () => {
    const text = workflows.find((w) => w.name === "ci.yml")?.text ?? "";
    expect(text).toMatch(/run: npm run verify$/m);
    expect(text).toMatch(/persist-credentials: false/);
    expect(text).toMatch(/cancel-in-progress:/);
  });
});
