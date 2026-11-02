import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../core/launchctl.js", () => ({
  launchdTargetsThisHome: () => false,
  runLaunchctl: () => {
    throw new Error("LIVE_SCHEDULER_FORBIDDEN");
  },
}));

import { checkLaunchAgentPathDrift, extractPlistProgramArguments } from "../drift-checks/launchagent-path.js";
import { setSetting } from "../settings.js";
import { defaultState, invalidateState, loadState, saveState } from "../state.js";
import { installLaunchAgent } from "./launchagent.js";
import { buildLaunchAgentFixArgs } from "./scheduler-paths.js";

interface RecordRow {
  event: string;
  admitted?: boolean;
  node?: string;
  cwd?: string;
  argv?: string[];
}
interface Outcome {
  code: number | null;
  error?: string;
  records: RecordRow[];
  beforeAdmission?: number;
}

let root: string;
let queue: string;
let cli: string;
let node: string;
let events: string;
let originalArgv: string;

function records(): RecordRow[] {
  return existsSync(events)
    ? readFileSync(events, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
}

function select(value: "direct" | "heavy-run"): void {
  saveState({ ...defaultState(), ...{ scheduledRepairQueue: value } });
  invalidateState();
}

function executable(path: string, source: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

function plistPath(): string {
  return join(homedir(), "Library/LaunchAgents/com.agentbrew.check.plist");
}

async function render(): Promise<string> {
  await installLaunchAgent();
  return readFileSync(plistPath(), "utf8");
}

// This runner proves dispatch only. It does not claim machine-queue ownership.
function fixtureQueue(): string {
  return [
    "#!" + process.execPath,
    "const fs = require('node:fs');",
    "const cp = require('node:child_process');",
    "const path = require('node:path');",
    "const log = (event) => fs.appendFileSync(process.env.FIXTURE_EVENTS, JSON.stringify({event})+'\\n');",
    "const mode = process.env.FIXTURE_QUEUE_MODE;",
    "function payload() {",
    "  const r = cp.spawnSync(process.argv[2], process.argv.slice(3), {stdio:'inherit', env:process.env, timeout:2000});",
    "  process.exit(r.status === null ? 125 : r.status);",
    "}",
    "if (process.env.HEAVY_RUN_HELD) { log('queue-bypass'); payload(); }",
    "log('queue-entry');",
    "if (mode === 'reject') process.exit(73);",
    "if (mode !== 'hold') { log('admitted'); payload(); }",
    "const release = process.env.FIXTURE_RELEASE;",
    "const timer = setTimeout(() => process.exit(124), 3500);",
    "const watcher = fs.watch(path.dirname(release), () => {",
    "  if (!fs.existsSync(release)) return;",
    "  watcher.close(); clearTimeout(timer); log('admitted'); payload();",
    "});",
    "process.stdout.write('QUEUE_WAITING\\n');",
  ].join("\n");
}

function launch(args: string[], mode = "admit", inheritedLease = ""): Promise<Outcome> {
  // This models a fresh launchd environment, not a child of the outer lease.
  const env: NodeJS.ProcessEnv = {
    HOME: homedir(),
    PATH: dirname(node) + ":/usr/bin:/bin",
    LANG: "C.UTF-8",
    AGENTBREW_NODE_BIN: node,
    FIXTURE_EVENTS: events,
    FIXTURE_QUEUE_MODE: mode,
    FIXTURE_RELEASE: join(root, "release"),
    HEAVY_RUN_HELD: inheritedLease,
  };
  return new Promise((resolve) => {
    const child = spawn(args[0], args.slice(1), { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let error: string | undefined;
    let beforeAdmission: number | undefined;
    let released = false;
    let bytes = 0;
    const stop = () => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {}
    };
    const timer = setTimeout(stop, 4500);
    child.on("error", (reason: NodeJS.ErrnoException) => {
      error = reason.code;
    });
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 4096) stop();
      if (!released && chunk.toString().includes("QUEUE_WAITING")) {
        beforeAdmission = records().filter((row) => row.event === "repair-start").length;
        released = true;
        writeFileSync(join(root, "release"), "release\n");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 4096) stop();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, error, records: records(), beforeAdmission });
    });
  });
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(homedir(), "scheduled repair ")));
  queue = join(root, "dotfiles/bin/heavy-run");
  cli = join(root, "repo/dist/cli.js");
  node = join(root, "approved/bin/node");
  events = join(root, "events.jsonl");
  mkdirSync(dirname(node), { recursive: true });
  symlinkSync(process.execPath, node);
  executable(queue, fixtureQueue());
  executable(
    cli,
    [
      "const fs = require('node:fs');",
      "const file = process.env.FIXTURE_EVENTS;",
      "const rows = fs.existsSync(file) ? fs.readFileSync(file,'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse) : [];",
      "fs.appendFileSync(file, JSON.stringify({event:'repair-start', admitted:rows.some(r=>r.event==='admitted'), node:process.execPath, cwd:process.cwd(), argv:process.argv.slice(2)})+'\\n');",
      "for (const event of ['sync-start','probe-start']) fs.appendFileSync(file, JSON.stringify({event})+'\\n');",
    ].join("\n"),
  );
  originalArgv = process.argv[1];
  process.argv[1] = cli;
  vi.stubEnv("DOTFILES_DIR", join(root, "dotfiles"));
  vi.stubEnv("AGENTBREW_NODE_BIN", node);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  select("heavy-run");
});

afterEach(() => {
  process.argv[1] = originalArgv;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
  rmSync(plistPath(), { force: true });
  invalidateState();
});

describe("scheduled repair queue admission", () => {
  it("Q01 keeps repair behind selected queue admission", async () => {
    const result = await launch(buildLaunchAgentFixArgs(), "hold");
    expect(result.records.filter((row) => row.event === "repair-start" && !row.admitted)).toHaveLength(0);
    expect(result.beforeAdmission).toBe(0);
    expect(result.code).toBe(0);
    expect(result.records.filter((row) => row.event === "repair-start")).toHaveLength(1);
  });

  it("Q02 preserves selected queue rejection without direct fallback", async () => {
    const result = await launch(buildLaunchAgentFixArgs(), "reject");
    expect(result.records.filter((row) => row.event === "repair-start")).toHaveLength(0);
    expect(result.code).toBe(73);
  });

  it("Q03 refuses a missing selected runner before repair", async () => {
    rmSync(queue);
    const result = await launch(buildLaunchAgentFixArgs());
    expect(result.records.filter((row) => row.event === "repair-start")).toHaveLength(0);
    expect(result.error !== undefined || result.code !== 0).toBe(true);
  });

  it("Q04 refuses a nonexecutable selected runner before repair", async () => {
    chmodSync(queue, 0o644);
    const result = await launch(buildLaunchAgentFixArgs());
    expect(result.records.filter((row) => row.event === "repair-start")).toHaveLength(0);
    expect(result.error !== undefined || result.code !== 0).toBe(true);
  });

  it("Q05 dispatches the approved Node payload after admission", async () => {
    const result = await launch(buildLaunchAgentFixArgs());
    expect(result.records.map((row) => row.event)).toEqual([
      "queue-entry",
      "admitted",
      "repair-start",
      "sync-start",
      "probe-start",
    ]);
    expect(result.records.find((row) => row.event === "repair-start")).toMatchObject({
      admitted: true,
      node: process.execPath,
      cwd: root,
      argv: ["fix"],
    });
    expect(result.code).toBe(0);
  });

  it("Q06 rejects an incoming lease rather than letting the runner bypass", async () => {
    const result = await launch(buildLaunchAgentFixArgs(), "admit", "SYNTHETIC_FOREIGN_LEASE");
    expect(result.records).toEqual([]);
    expect(result.code).not.toBe(0);
  });

  it("Q07 retains the explicit Node override in a queued plist", async () => {
    const content = await render();
    expect(extractPlistProgramArguments(content)).toContain(node);
    expect(content).toContain("<key>AGENTBREW_NODE_BIN</key>\n        <string>" + node + "</string>");
  });

  it("Q08 reports selected queue routing not yet installed", async () => {
    select("direct");
    await render();
    select("heavy-run");
    expect(checkLaunchAgentPathDrift().some((item) => item.type === "launchagent" && /queue/iu.test(item.detail))).toBe(
      true,
    );
  });

  it("Q09 detects a missing Node even behind a queue prefix", async () => {
    await render();
    rmSync(node);
    expect(checkLaunchAgentPathDrift().some((item) => item.type === "launchagent" && item.detail.includes(node))).toBe(
      true,
    );
  });

  it("Q10 preserves the standalone direct route", () => {
    select("direct");
    expect(buildLaunchAgentFixArgs()).toEqual([node, cli, "fix"]);
  });

  it("Q11 sets queue policy through the configuration API without changing opt-ins", () => {
    saveState({ ...defaultState(), autoRepair: "off", memory: { enabled: true } });
    invalidateState();
    expect(setSetting("scheduledRepairQueue", "heavy-run").ok).toBe(true);
    expect(loadState()).toMatchObject({
      scheduledRepairQueue: "heavy-run",
      autoRepair: "off",
      memory: { enabled: true },
    });
    expect(setSetting("scheduledRepairQueue", "other").ok).toBe(false);
  });

  it("Q12 preserves scheduler fields without copying the caller lease", async () => {
    vi.stubEnv("HEAVY_RUN_HELD", "SYNTHETIC_CALLER_LEASE");
    const content = await render();
    expect(content).toContain(
      "<key>WorkingDirectory</key>\n    <string>" + join(homedir(), ".local/share/agentbrew/logs") + "</string>",
    );
    expect(content).toContain("<key>StartInterval</key>\n    <integer>1800</integer>");
    expect(content).toContain("<key>RunAtLoad</key>\n    <true/>");
    expect(content).toContain("<key>LANG</key>");
    expect(content).toContain(join(homedir(), ".local/share/agentbrew/logs/launchagent.log"));
    expect(content).toContain(join(homedir(), ".local/share/agentbrew/logs/launchagent.err"));
    expect(content).not.toContain("SYNTHETIC_CALLER_LEASE");
    expect(content).not.toContain("<key>HEAVY_RUN_HELD</key>");
  });
});
