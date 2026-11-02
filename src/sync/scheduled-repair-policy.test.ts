import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fault = vi.hoisted(() => ({ path: "", read: false, metadata: false }));
const marker = "STATIC_QUEUE_POLICY_FIXTURE";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const denied = () => Object.assign(new Error("STATIC_QUEUE_POLICY_FIXTURE"), { code: "EACCES" });
  return {
    ...actual,
    readFileSync: (...args: unknown[]) => {
      if (fault.read && String(args[0]) === fault.path) throw denied();
      return Reflect.apply(actual.readFileSync, actual, args);
    },
    lstatSync: (...args: unknown[]) => {
      if (fault.metadata && String(args[0]) === fault.path) throw denied();
      return Reflect.apply(actual.lstatSync, actual, args);
    },
  };
});

import { defaultState, getStatePath, invalidateState } from "../state.js";
import { buildLaunchAgentFixArgs } from "./scheduler-paths.js";

let root: string;
let cli: string;
let output: string;
let originalArgv: string;
let originalExitCode: typeof process.exitCode;
let diagnostics: ReturnType<typeof vi.spyOn>;

function state(value: unknown): void {
  mkdirSync(dirname(getStatePath()), { recursive: true });
  writeFileSync(getStatePath(), JSON.stringify(value));
  invalidateState();
}

function attempt(): { starts: number; refused: boolean; leaked: boolean; exit?: number | null; args?: string[] } {
  let refused = false;
  let leaked = false;
  let exit: number | null | undefined;
  let args: string[] | undefined;
  try {
    args = buildLaunchAgentFixArgs();
  } catch (error) {
    refused =
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "SCHEDULED_REPAIR_POLICY_UNAVAILABLE";
    leaked = error instanceof Error && error.message.includes(marker);
  }
  if (args) {
    const result = spawnSync(args[0], args.slice(1), {
      cwd: root,
      encoding: "utf8",
      timeout: 2000,
      env: { HOME: homedir(), PATH: dirname(process.execPath) + ":/usr/bin:/bin", FIXTURE_EVENT: output },
    });
    exit = result.status;
    leaked ||= result.stdout?.includes(marker) || result.stderr?.includes(marker);
  }
  leaked ||= diagnostics.mock.calls.some((args: unknown[]) =>
    args.some((value: unknown) => String(value).includes(marker)),
  );
  const starts = existsSync(output) ? readFileSync(output, "utf8").split("\n").filter(Boolean).length : 0;
  return { starts, refused, leaked, exit, args };
}

function refuses(): void {
  const result = attempt();
  expect(result.starts).toBe(0);
  expect(result.refused).toBe(true);
  expect(result.leaked).toBe(false);
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(homedir(), "repair-policy-")));
  cli = join(root, "repo/dist/cli.js");
  output = join(root, "payload-events");
  mkdirSync(dirname(cli), { recursive: true });
  writeFileSync(
    cli,
    [
      "if (process.argv[2] !== 'fix') process.exit(2);",
      "require('node:fs').appendFileSync(process.env.FIXTURE_EVENT, 'repair-start\\n');",
    ].join("\n"),
  );
  originalArgv = process.argv[1];
  originalExitCode = process.exitCode;
  process.argv[1] = cli;
  vi.stubEnv("AGENTBREW_NODE_BIN", process.execPath);
  diagnostics = vi.spyOn(console, "error").mockImplementation(() => {});
  fault.path = getStatePath();
  fault.read = fault.metadata = false;
  state(defaultState());
});

afterEach(() => {
  fault.read = fault.metadata = false;
  process.argv[1] = originalArgv;
  process.exitCode = originalExitCode;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
  rmSync(getStatePath(), { force: true });
  invalidateState();
});

describe("scheduled repair persisted policy validity", () => {
  it("S01 refuses an invalid enum without printing its value", () => {
    state({ ...defaultState(), scheduledRepairQueue: marker });
    refuses();
  });

  it("S02 refuses a nonstring policy without printing its value", () => {
    state({ ...defaultState(), scheduledRepairQueue: { unexpected: marker } });
    refuses();
  });

  it("S03 refuses malformed existing state without printing parser context", () => {
    writeFileSync(getStatePath(), "scheduledRepairQueue: [" + marker);
    invalidateState();
    refuses();
  });

  it("S04 refuses a deterministically unreadable existing state", () => {
    fault.read = true;
    refuses();
  });

  it("S05 preserves direct repair for valid legacy state without the field", () => {
    const result = attempt();
    expect(result.args).toEqual([process.execPath, cli, "fix"]);
    expect(result.starts).toBe(1);
    expect(result.exit).toBe(0);
    expect(result.leaked).toBe(false);
  });

  it("S06 preserves direct repair when state is genuinely missing", () => {
    rmSync(getStatePath());
    invalidateState();
    const result = attempt();
    expect(result.args).toEqual([process.execPath, cli, "fix"]);
    expect(result.starts).toBe(1);
    expect(result.exit).toBe(0);
    expect(result.leaked).toBe(false);
  });

  it("S07 refuses state metadata failure instead of treating it as absence", () => {
    fault.metadata = true;
    refuses();
  });
});
