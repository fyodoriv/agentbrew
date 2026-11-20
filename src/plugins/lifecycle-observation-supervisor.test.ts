import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const fixture = fileURLToPath(new URL("./lifecycle-observation-supervisor-fixture.mjs", import.meta.url));
const WAIT_MS = 9_000;

function start(role: "sentinel" | "supervisor", mode: string, detached = true) {
  const child = spawn(process.execPath, [fixture, role, mode], {
    detached,
    env: { PATH: "/usr/bin:/bin" },
    stdio: ["ignore", "pipe", "ignore", "ipc"],
  });
  const stdout = child.stdout;
  let output = "";
  let readySeen = false;
  const ready = new Promise<void>((resolve) => {
    child.on("message", (message) => {
      if (message !== "ready") return;
      readySeen = true;
      resolve();
    });
  });
  stdout?.setEncoding("utf8");
  stdout?.on("data", (chunk: string) => {
    output += chunk;
  });
  const complete = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    records: string[];
    readySeen: boolean;
  }>((resolve, reject) => {
    const deadline = setTimeout(() => {
      if (child.connected) child.disconnect();
      stdout?.destroy();
      child.unref();
      reject(new Error("fixture missed its terminal deadline"));
    }, WAIT_MS);
    child.once("error", (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(deadline);
      resolve({ code, signal, records: output.trim().split("\n").filter(Boolean), readySeen });
    });
  });
  const send = async (message: "stop" | "confirm") => {
    await Promise.race([
      ready,
      complete.then(() => {
        throw new Error("fixture ended before acknowledging readiness");
      }),
    ]);
    await new Promise<void>((resolve, reject) => {
      child.send(message, (error) => (error ? reject(error) : resolve()));
    });
  };
  return { complete, ready, send };
}

async function requestStop(mode: string, detached = true) {
  const fixtureRun = start("supervisor", mode, detached);
  const settled = Promise.allSettled([fixtureRun.complete]);
  try {
    await fixtureRun.send("stop");
    return await fixtureRun.complete;
  } finally {
    await settled;
  }
}

describe.skipIf(!["darwin", "linux"].includes(process.platform))("lifecycle supervisor ownership fixture", () => {
  it(
    "S01 completes without a signal request",
    async () => {
      const result = await start("supervisor", "normal").complete;
      expect(result).toEqual({ code: 0, signal: null, records: ["worker-completed"], readySeen: false });
    },
    WAIT_MS + 500,
  );

  it(
    "S02 stops the owned group and leaves a live sentinel alone",
    async () => {
      const sentinel = start("sentinel", "separate", false);
      const stopper = start("supervisor", "stop");
      const completion = Promise.allSettled([sentinel.complete, stopper.complete]);
      try {
        await Promise.race([
          sentinel.ready,
          sentinel.complete.then(() => {
            throw new Error("sentinel missed its ready acknowledgment");
          }),
        ]);
        await stopper.send("stop");
        const result = await stopper.complete;
        await sentinel.send("confirm");
        expect(result).toEqual({
          code: 0,
          signal: null,
          records: ["signal-attempt", "worker-stopped", "supervisor-stopped"],
          readySeen: true,
        });
        expect(await sentinel.complete).toEqual({
          code: 0,
          signal: null,
          records: ["sentinel-normal"],
          readySeen: true,
        });
      } finally {
        await completion;
      }
    },
    WAIT_MS + 500,
  );

  it(
    "S03 keeps a failed signal separate from observed expiry",
    async () => {
      expect(await requestStop("signal-failure")).toEqual({
        code: 0,
        signal: null,
        records: ["signal-attempt", "signal-failed", "worker-expired", "supervisor-expired"],
        readySeen: true,
      });
    },
    WAIT_MS + 500,
  );

  it(
    "S04 refuses a stop in the caller's group",
    async () => {
      expect(await requestStop("wrong-group", false)).toEqual({
        code: 0,
        signal: null,
        records: ["wrong-group", "worker-expired", "supervisor-expired"],
        readySeen: true,
      });
    },
    WAIT_MS + 500,
  );

  it(
    "S05 sends no stop when readiness is unavailable",
    async () => {
      expect(await start("supervisor", "no-ready").complete).toEqual({
        code: 0,
        signal: null,
        records: ["worker-expired", "supervisor-expired"],
        readySeen: false,
      });
    },
    WAIT_MS + 500,
  );
});
