import { closeSync, mkdtempSync, openSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectMemoryDatabase, type ProbeResult } from "./upgrade-preflight.js";

describe("memory database upgrade preflight", () => {
  it.each([
    "matching",
    "extra-listener",
    "extra-holder",
    "extra-sidecar-holder",
    "missing-holder",
    "changing-holder",
    "changing-file",
    "wrong-file",
    "broken-ancestry",
    "probe-error",
  ])("checks %s evidence before a handoff", (scenario) => {
    const dir = mkdtempSync(join(tmpdir(), "memory-preflight-"));
    try {
      const db = join(dir, "memory.db");
      writeFileSync(db, "synthetic");
      if (scenario === "extra-sidecar-holder") writeFileSync(`${db}-wal`, "synthetic");
      const stat = statSync(db, { bigint: true });
      let fileProbes = 0;
      let holderProbes = 0;
      const run = (program: string, args: string[]): ProbeResult => {
        if (scenario === "probe-error") return { status: 1, stdout: "", stderr: "denied" };
        if (program === "/bin/ps") {
          const pid = args[args.indexOf("-p") + 1];
          return {
            status: 0,
            stdout: `${pid === "202" && scenario !== "broken-ancestry" ? "101" : "1"} Sat Nov 14 00:00:00 2026\n`,
            stderr: "",
          };
        }
        if (args.includes("-iTCP:18765"))
          return { status: 0, stdout: scenario === "extra-listener" ? "202\n203\n" : "202\n", stderr: "" };
        if (args.includes("-F0pfnDi")) {
          fileProbes++;
          const ino =
            scenario === "wrong-file" || (scenario === "changing-file" && fileProbes > 1) ? stat.ino + 1n : stat.ino;
          return {
            status: 0,
            stdout: `p202\0f4\0D0x${stat.dev.toString(16)}\0i${ino}\0n${realpathSync(db)}\0`,
            stderr: "",
          };
        }
        holderProbes++;
        return {
          status: 0,
          stdout:
            scenario === "extra-holder" || (scenario === "extra-sidecar-holder" && args.includes(`${db}-wal`))
              ? `202\n999\n${process.pid}\n`
              : scenario === "missing-holder" || (scenario === "changing-holder" && holderProbes > 1)
                ? `${process.pid}\n`
                : `202\n${process.pid}\n`,
          stderr: "",
        };
      };
      const result = inspectMemoryDatabase({ dbPath: db, jobPid: 101, port: 18765, run });
      expect(result.visibleEvidenceConsistent).toBe(scenario === "matching");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === "darwin")(
    "observes a real scratch listener and file",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "memory-preflight-real-"));
      const db = join(dir, "memory.db");
      writeFileSync(db, "synthetic");
      const fd = openSync(db, "r");
      const server = createServer();
      try {
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", () => resolve());
        });
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("missing scratch port");
        expect(inspectMemoryDatabase({ dbPath: db, jobPid: process.pid, port: address.port })).toEqual({
          visibleEvidenceConsistent: true,
        });
        const other = spawn(
          process.execPath,
          [
            "-e",
            'require("node:fs").openSync(process.argv[1], "r"); console.log("ready"); setInterval(() => {}, 1000);',
            db,
          ],
          { stdio: ["ignore", "pipe", "ignore"] },
        );
        try {
          await once(other.stdout, "data", { signal: AbortSignal.timeout(10000) });
          expect(inspectMemoryDatabase({ dbPath: db, jobPid: process.pid, port: address.port })).toEqual({
            visibleEvidenceConsistent: false,
          });
        } finally {
          if (other.exitCode === null && other.signalCode === null) {
            const exited = once(other, "exit");
            other.kill();
            await exited;
          }
        }
      } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        closeSync(fd);
        rmSync(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});

import { spawn } from "node:child_process";
import { once } from "node:events";
