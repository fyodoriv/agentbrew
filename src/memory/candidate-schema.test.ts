import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { checkCandidateSchema } from "./candidate-schema.js";

it("checks the exact database with the pinned upstream candidate and fails closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "memory-schema-check-"));
  try {
    const tool = join(dir, "uvx");
    const db = join(dir, "memory.db");
    writeFileSync(db, "synthetic");
    writeFileSync(join(dir, "cwd-marker"), "synthetic");
    writeFileSync(
      tool,
      '#!/bin/sh\n[ -f cwd-marker ] && [ "$1" = "--python" ] && [ "$2" = "3.13" ] && [ "$3" = "--system-certs" ] && [ "$4" = "--from" ] && [ "$5" = "mcp-memory-service[sqlite]==12.9.0" ] && [ "$6" = "memory" ] && [ "$7" = "check-db" ] && [ "$8" = "--db-path" ] && [ "$9" = "$EXPECTED_DB" ] || exit 1\nexit "${FAKE_STATUS:-0}"\n',
    );
    chmodSync(tool, 0o700);
    const options = { uvxBin: tool, cwd: dir, env: { ...process.env, EXPECTED_DB: db } };
    expect(checkCandidateSchema(db, "mcp-memory-service[sqlite]==12.9.0", options)).toBe(true);
    expect(
      checkCandidateSchema(db, "mcp-memory-service[sqlite]==12.9.0", {
        ...options,
        env: { ...options.env, FAKE_STATUS: "1" },
      }),
    ).toBe(false);
    expect(checkCandidateSchema(db, "mcp-memory-service[sqlite]==12.8.0", options)).toBe(false);
    expect(checkCandidateSchema(db, "other-package==12.9.0", options)).toBe(false);
    for (const special of ["#", "?", "%"]) {
      const ambiguous = join(dir, `memory${special}other.db`);
      writeFileSync(ambiguous, "synthetic");
      expect(
        checkCandidateSchema(ambiguous, "mcp-memory-service[sqlite]==12.9.0", {
          ...options,
          env: { ...options.env, EXPECTED_DB: ambiguous },
        }),
      ).toBe(false);
    }
    expect(
      checkCandidateSchema(db, "mcp-memory-service[sqlite]==12.9.0", { ...options, uvxBin: join(dir, "missing") }),
    ).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
