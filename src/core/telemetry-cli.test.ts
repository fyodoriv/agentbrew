import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AUTO_TIMEOUT_MS } from "./telemetry.js";

/**
 * The real CLI, `agentbrew sync`, with a send that cannot finish. Each run is
 * a real process with a scratch home, so the whole path is under test: the
 * command, the event log, the start of the send, and the process exit.
 */

const ROOT = join(import.meta.dirname, "../..");
/** The most time a hung send may add to a sync. */
const ADDED_LIMIT_MS = 3_500;
/** A sync that is still running after this long is held open; the test stops it. */
const HELD_MS = 20_000;

interface Run {
  code: number | null;
  pid: number;
  /** Time from the end of the sync work (its `sync` event) to the process exit. */
  addedMs: number;
  commands: string[];
}

const pidsToStop: number[] = [];
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function waitFor(check: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
}

function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "ab-tel-cli-"));
  writeFileSync(
    join(home, "telemetry.json"),
    JSON.stringify({ installId: "0123456789abcdef0123456789abcdef", sent: 0, consent: "yes" }),
  );
  // A sync writes generated files under AGENTBREW_DIR, so it gets a scratch copy, never the repo.
  const source = join(home, "agentbrew-src");
  mkdirSync(source);
  cpSync(join(ROOT, "templates"), join(source, "templates"), { recursive: true });
  symlinkSync(join(ROOT, "skill-plugins"), join(source, "skill-plugins"));
  return home;
}

async function runSync(home: string, extra: Record<string, string>): Promise<Run> {
  const log = join(home, "events.jsonl");
  const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", "sync"], {
    cwd: ROOT,
    stdio: "ignore",
    // A fixed env: no CI flag, no test off switch, and an example key that is not a real one.
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      HOME: home,
      AGENTBREW_DIR: join(home, "agentbrew-src"),
      NO_COLOR: "1",
      AGENTBREW_EVENTS_FILE: log,
      AGENTBREW_TELEMETRY_STATE: join(home, "telemetry.json"),
      AGENTBREW_POSTHOG_KEY: "phc_exampleOnly123",
      ...extra,
    },
  });
  const pid = child.pid as number;
  pidsToStop.push(pid);
  const held = setTimeout(() => child.kill("SIGKILL"), HELD_MS);
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  const endedAt = Date.now();
  clearTimeout(held);
  const events = (existsSync(log) ? readFileSync(log, "utf-8") : "")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { ts: string; event: string; command?: string });
  const syncDone = events.find((e) => e.event === "sync");
  return {
    code,
    pid,
    addedMs: syncDone ? endedAt - Date.parse(syncDone.ts) : Number.POSITIVE_INFINITY,
    commands: events.filter((e) => e.event === "command").map((e) => String(e.command)),
  };
}

describe("agentbrew sync with a send that cannot finish", () => {
  afterEach(() => {
    for (const pid of pidsToStop.splice(0)) {
      if (alive(pid)) process.kill(pid, "SIGKILL");
    }
  });

  it("a server that accepts and never answers does not hold the sync or change its exit code", {
    timeout: 180_000,
  }, async () => {
    const sockets: Socket[] = [];
    const server = createServer((socket) => {
      sockets.push(socket);
      socket.on("error", () => {});
    });
    // Needs a real local port: outside the agent sandbox (AGENTS.md Gotchas).
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address() as { port: number };
    const url = `http://127.0.0.1:${port}/batch/`;
    try {
      const baseline = await runSync(scratchHome(), { AGENTBREW_TELEMETRY_URL: url, DO_NOT_TRACK: "1" });
      expect(sockets, "an off switch sends nothing").toHaveLength(0);
      const home = scratchHome();
      const run = await runSync(home, { AGENTBREW_TELEMETRY_URL: url });
      expect(run.code).toBe(baseline.code);
      expect(run.addedMs).toBeLessThan(ADDED_LIMIT_MS);
      expect(await waitFor(() => sockets.length > 0, 15_000), "the send reached the server").toBe(true);
      // The send is a separate, quiet process: it adds no event of its own.
      expect(run.commands).toEqual(["sync"]);
      expect(readFileSync(join(home, "events.jsonl"), "utf-8")).not.toContain("telemetry");
    } finally {
      for (const socket of sockets) socket.destroy();
      server.close();
    }
  });

  it("a DNS lookup that never returns does not hold the sync, and the sending process still ends", {
    timeout: 180_000,
  }, async () => {
    // A stand-in for a hung resolver: the lookup never calls back, and it keeps the
    // event loop alive for 30 s, like a getaddrinfo call that cannot be cancelled.
    const home = scratchHome();
    const mark = join(home, "dns-lookups.txt");
    const stub = join(home, "hung-dns.cjs");
    writeFileSync(
      stub,
      [
        'const dns = require("node:dns");',
        'const fs = require("node:fs");',
        "dns.lookup = function hungLookup() {",
        `  fs.appendFileSync(${JSON.stringify(mark)}, String(process.pid) + "\\n");`,
        "  setTimeout(() => {}, 30_000);",
        "};",
      ].join("\n"),
    );
    const env = {
      AGENTBREW_TELEMETRY_URL: "http://agentbrew-hung-dns.invalid/batch/",
      NODE_OPTIONS: `--require ${stub}`,
    };
    const baseline = await runSync(scratchHome(), { ...env, DO_NOT_TRACK: "1" });
    expect(existsSync(mark), "an off switch starts no lookup").toBe(false);
    const run = await runSync(home, env);
    expect(run.code).toBe(baseline.code);
    expect(run.addedMs).toBeLessThan(ADDED_LIMIT_MS);
    expect(await waitFor(() => existsSync(mark), 15_000), "the send started the lookup").toBe(true);
    const sender = Number(readFileSync(mark, "utf-8").trim().split("\n")[0]);
    pidsToStop.push(sender);
    expect(sender, "the lookup runs in a process the sync does not wait for").not.toBe(run.pid);
    // The sending process has a hard limit of its own; the hung lookup cannot keep it alive.
    expect(await waitFor(() => !alive(sender), AUTO_TIMEOUT_MS + 6_000), "the sending process ended").toBe(true);
  });
});
