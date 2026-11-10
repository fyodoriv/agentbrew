import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real processes race for a stale send lock with a stale takeover guard
 * beside it: the state a send leaves when it dies during a takeover. Each
 * round starts every sender at the same instant. The server counts how often
 * each event arrives.
 */

const ROOT = join(import.meta.dirname, "../..");
const SENDERS = 8;
const ROUNDS = 200;
const EVENTS_PER_ROUND = 3;
/** Older than the stale time of the send lock (60 seconds). */
const STALE_AGE_MS = 120_000;

/** One sender process. It waits for a round on stdin, starts at the given instant, and sends twice. */
const WORKER = `
import { createInterface } from "node:readline";
const { send } = await import(${JSON.stringify(pathToFileURL(join(ROOT, "src/core/telemetry.ts")).href)});
process.stdout.write("READY\\n");
for await (const line of createInterface({ input: process.stdin })) {
  const { dir, at } = JSON.parse(line);
  process.env.AGENTBREW_TELEMETRY_STATE = dir + "/telemetry.json";
  process.env.AGENTBREW_EVENTS_FILE = dir + "/events.jsonl";
  while (Date.now() < at) {}
  const first = await send("1.0.0");
  const second = await send("1.0.0");
  process.stdout.write(JSON.stringify({ sent: first.sent + second.sent }) + "\\n");
}
`;

interface Sender {
  child: ChildProcess;
  next: () => Promise<string>;
}

let server: Server;
let home: string;
const senders: Sender[] = [];
/** How many times each event (by its timestamp) reached the server. */
const seen = new Map<string, number>();

function startSender(url: string): Sender {
  const script = join(home, "sender.mjs");
  const child = spawn(process.execPath, ["--import", "tsx", script], {
    cwd: ROOT,
    stdio: ["pipe", "pipe", "ignore"],
    // A fixed env: no CI flag, no test off switch, and an example key that is not a real one.
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      HOME: home,
      AGENTBREW_POSTHOG_KEY: "phc_exampleOnly123",
      AGENTBREW_TELEMETRY_URL: url,
      AGENTBREW_EVENTS: "0",
    },
  });
  const waiting: ((line: string) => void)[] = [];
  const lines: string[] = [];
  createInterface({ input: child.stdout as NodeJS.ReadableStream }).on("line", (line) => {
    const resolve = waiting.shift();
    if (resolve) resolve(line);
    else lines.push(line);
  });
  const next = (): Promise<string> =>
    new Promise((resolve) => {
      const line = lines.shift();
      if (line !== undefined) resolve(line);
      else waiting.push(resolve);
    });
  return { child, next };
}

/** A round's files: a few events, a stored yes, a lock a dead send left, and a guard a dead takeover left. */
function seedRound(round: number): string {
  const dir = join(home, `round-${round}`);
  mkdirSync(dir);
  const rows = Array.from({ length: EVENTS_PER_ROUND }, (_, i) =>
    JSON.stringify({
      ts: new Date(Date.UTC(2026, 10, 9, 12, 0, 0) + round * 1000 + i).toISOString(),
      event: "command",
      command: "status",
      ok: true,
      ms: 1,
    }),
  );
  writeFileSync(join(dir, "events.jsonl"), `${rows.join("\n")}\n`);
  writeFileSync(
    join(dir, "telemetry.json"),
    JSON.stringify({ installId: "0123456789abcdef0123456789abcdef", sent: 0, consent: "yes" }),
  );
  const old = new Date(Date.now() - STALE_AGE_MS);
  for (const name of ["telemetry.json.lock", "telemetry.json.lock.steal"]) {
    writeFileSync(join(dir, name), "999999 dead");
    utimesSync(join(dir, name), old, old);
  }
  return dir;
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "ab-tel-race-"));
  writeFileSync(join(home, "sender.mjs"), WORKER);
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      for (const item of (JSON.parse(body) as { batch: { timestamp: string }[] }).batch) {
        seen.set(item.timestamp, (seen.get(item.timestamp) ?? 0) + 1);
      }
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/batch/`;
  for (let i = 0; i < SENDERS; i += 1) senders.push(startSender(url));
  await Promise.all(senders.map((sender) => sender.next()));
}, 120_000);

afterAll(async () => {
  for (const sender of senders) sender.child.kill("SIGKILL");
  await new Promise((resolve) => server.close(resolve));
  rmSync(home, { recursive: true, force: true });
});

describe("telemetry send lock under a real race", () => {
  it("many sends at once against a stale lock and a stale guard post each event exactly once", async () => {
    let sent = 0;
    for (let round = 0; round < ROUNDS; round += 1) {
      const dir = seedRound(round);
      const at = Date.now() + 20;
      for (const sender of senders) sender.child.stdin?.write(`${JSON.stringify({ dir, at })}\n`);
      const results = await Promise.all(senders.map((sender) => sender.next()));
      for (const result of results) sent += (JSON.parse(result) as { sent: number }).sent;
    }
    const repeated = [...seen.values()].filter((count) => count > 1).length;
    expect(repeated).toBe(0);
    // Every event arrived, and the senders' own counts agree with the server.
    expect(seen.size).toBe(ROUNDS * EVENTS_PER_ROUND);
    expect(sent).toBe(ROUNDS * EVENTS_PER_ROUND);
  }, 300_000);
});
