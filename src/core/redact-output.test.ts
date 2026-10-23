import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { redactStreamWrites } from "./redact-output.js";

describe("redactStreamWrites", () => {
  it("redacts string and byte chunks and passes the other arguments through", () => {
    const written: unknown[][] = [];
    const stream = {
      write: (chunk: unknown, ...rest: unknown[]) => {
        written.push([chunk, ...rest]);
        return true;
      },
    };
    redactStreamWrites(stream);
    const done = () => undefined;
    stream.write("Pulling https://alice:tok123@host/r\n", "utf-8", done);
    stream.write(Buffer.from("fatal: https://tok123@host/r\n"));
    expect(String(written[0]?.[0])).toBe("Pulling https://***@host/r\n");
    expect(written[0]?.slice(1)).toEqual(["utf-8", done]);
    expect(String(written[1]?.[0])).toBe("fatal: https://***@host/r\n");
  });
});

describe("the agentbrew CLI", () => {
  it("never prints a token from a source URL, whichever command prints it", () => {
    const home = mkdtempSync(join(tmpdir(), "redact-cli-"));
    try {
      mkdirSync(join(home, ".config", "agentbrew"), { recursive: true });
      writeFileSync(
        join(home, ".config", "agentbrew", "state.yaml"),
        "agents: []\nsources:\n  - url: https://alice:tok123@git.example.invalid/org/skills.git\n    type: git\nmcpServers: []\ncatalogVersion: 0.1.0\n",
      );
      // FORCE_COLOR: chalk colors the URL as in a real terminal.
      const out = execFileSync(process.execPath, ["--import", "tsx", "src/cli.ts", "catalog", "--sources"], {
        env: { ...process.env, HOME: home, AGENTBREW_NO_AUTO_INIT: "1", FORCE_COLOR: "1" },
        encoding: "utf-8",
        timeout: 60_000,
      });
      expect(out).toContain("git.example.invalid");
      expect(out).not.toContain("tok123");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 90_000);
});
