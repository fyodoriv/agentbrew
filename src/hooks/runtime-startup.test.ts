import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const hooks = resolve(import.meta.dirname, "../../hooks");
const stdinLibrary = join(hooks, "lib/stdin-json.sh");
const macToolchains = [
  "/Library/Developer/CommandLineTools/usr/bin/python3",
  "/Applications/Xcode.app/Contents/Developer/usr/bin/python3",
];

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

describe("managed hook startup", () => {
  let scratch: string;
  let fakeBin: string;
  let recording: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "agentbrew-hook-startup-"));
    fakeBin = join(scratch, "bin");
    mkdirSync(fakeBin);
    recording = join(scratch, "calls");
  });

  afterEach(() => rmSync(scratch, { recursive: true, force: true }));

  function installStub(name: string, source: string): string {
    const path = join(fakeBin, name);
    writeFileSync(path, `#!/bin/bash\n${source}`, { mode: 0o755 });
    return path;
  }

  function bash(args: string[], input = "", overrides: NodeJS.ProcessEnv = {}) {
    return spawnSync("/bin/bash", args, {
      cwd: scratch,
      env: {
        ...process.env,
        PATH: fakeBin + delimiter + process.env.PATH,
        HOOK_DECISIONS_LOG: "decisions.jsonl",
        HOOK_PROCESS_RECEIPT: recording,
        HOOK_PYTHON: "",
        ...overrides,
      },
      input,
      timeout: 5000,
      encoding: "utf8",
    });
  }

  function hook(name: string, input: object, overrides?: NodeJS.ProcessEnv) {
    return bash([join(hooks, "checks", `${name}.sh`)], JSON.stringify(input), overrides);
  }

  function recordReaders(): void {
    installStub("dirname", 'printf "dirname\\n" >> "$HOOK_PROCESS_RECEIPT"\nexec /usr/bin/dirname "$@"\n');
    installStub("cat", 'printf "cat\\n" >> "$HOOK_PROCESS_RECEIPT"\nexec /bin/cat "$@"\n');
  }

  const guardBudget = { deadlineMs: 1000, recordedLaunches: 2 };

  function runGuardFixture(args: string[], input: string, _budget: typeof guardBudget): number | null {
    return bash(args, input).status;
  }

  it("keeps a timely fixture result", () => {
    expect(runGuardFixture(["-c", "exit 2"], "", guardBudget)).toBe(2);
  });

  it("reports a missing guard decision at the fixture deadline", () => {
    expect(() => runGuardFixture(["-c", "exec /bin/sleep 2"], "", guardBudget)).toThrow(
      "Guard fixture timed out after 1000 ms",
    );
  });

  it("reports a guard fixture that exceeds its recorded launch budget", () => {
    installStub("record-step", 'printf "%s\\n" step >> "$HOOK_PROCESS_RECEIPT"');
    expect(() => runGuardFixture(["-c", "record-step; record-step; record-step"], "", guardBudget)).toThrow(
      "Guard fixture recorded 3 launches (limit 2)",
    );
  });

  it.each([
    ["export const sample = 1;", 0],
    ["// 2026-05-27 sample\nexport const sample = 1;", 2],
  ])("preserves a real PreToolUse guard verdict", (content, expected) => {
    const input = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: join(scratch, "sample.ts"), content },
    });
    expect(runGuardFixture([join(hooks, "checks", "code-no-timestamps.sh")], input, guardBudget)).toBe(expected);
    expect(existsSync(join(scratch, "sample.ts"))).toBe(false);
  });

  it.each([
    "tests-adapt-to-production",
    "gdoc-comment-preservation",
    "jira-no-grandchildren",
  ])("%s reads Bash input and logs without external dirname or cat", (name) => {
    recordReaders();
    const result = hook(name, { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } });
    expect(result.status).toBe(0);
    expect(existsSync(recording)).toBe(false);
    expect(JSON.parse(readFileSync(join(scratch, "decisions.jsonl"), "utf8")).hookId).toBe(name);
  });

  it("boots and drains input without an external reader when Dotfiles is absent", () => {
    recordReaders();
    const result = bash([join(hooks, "lib/bootstrap-endpoint-path.sh")], "synthetic input\n");
    expect(result.status).toBe(0);
    expect(existsSync(recording)).toBe(false);
  });

  it("preserves multiline JSON and backslashes in stdin", () => {
    const input = JSON.stringify({ tool_input: { command: "echo \\path\nnext" } }, null, 2);
    const result = bash(["-c", 'source "$1"; read_hook_stdin', "_", stdinLibrary], input);
    expect(result).toMatchObject({ status: 0, stdout: input });
  });

  it("uses the explicit interpreter override before system or PATH candidates", () => {
    installStub("python3", 'printf "path\\n"');
    const override = installStub("override", 'printf "override:%s\\n" "$1"');
    const result = bash(["-c", 'source "$1"; hook_python -c "pass"', "_", stdinLibrary], "", { HOOK_PYTHON: override });
    expect(result).toMatchObject({ status: 0, stdout: "override:-I\n" });
  });

  it("prefers an installed Mac toolchain and otherwise uses PATH", () => {
    installStub("python3", 'printf "path:%s\\n" "$1"');
    const result = bash([
      "-c",
      'source "$1"; hook_python -c "$2"',
      "_",
      stdinLibrary,
      'import sys; assert sys.flags.isolated; print("system")',
    ]);
    expect(result).toMatchObject({
      status: 0,
      stdout: macToolchains.some(executable) ? "system\n" : "path:-I\n",
    });
  });

  it("runs both existing Python helpers through the same isolated interpreter route", () => {
    const override = installStub(
      "override",
      'printf "%s %s\\n" "$1" "${2##*/}" >> "$HOOK_PROCESS_RECEIPT"\nexec python3 "$@"\n',
    );
    const search = hook(
      "no-home-crawl",
      { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "rg word ." }, cwd: scratch },
      { HOOK_PYTHON: override },
    );
    const transcript = join(scratch, "transcript.jsonl");
    writeFileSync(transcript, "{}\n");
    const stop = hook(
      "a-pr-is-not-ready",
      { hook_event_name: "Stop", transcript_path: transcript },
      { HOOK_PYTHON: override },
    );
    expect([search.status, stop.status]).toEqual([0, 0]);
    expect(readFileSync(recording, "utf8")).toBe("-I no-home-crawl.py\n-I pr-command-target.py\n");
  });
});
