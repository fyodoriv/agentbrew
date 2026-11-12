import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../memory/backup.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../memory/backup.js")>()),
  writeMemoryBackup: vi.fn(() => "/tmp/fixture-memory-backup.db"),
  verifySqliteBackup: vi.fn(),
}));

import { verifySqliteBackup } from "../memory/backup.js";
import { registerMemoryCommands } from "./cli-memory.js";
import { buildTestProgram } from "./test-program.js";

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("memory backup verification", () => {
  it.each([false, true])("returns a failure for an invalid backup (JSON: %s)", async (json) => {
    vi.mocked(verifySqliteBackup).mockReturnValue({ ok: false });
    const output = vi.spyOn(console, json ? "log" : "error").mockImplementation(() => undefined);
    const program = buildTestProgram((p) => registerMemoryCommands(p));

    await program.parseAsync(["node", "test", "memory", "backup", ...(json ? ["--json"] : [])]);

    expect(process.exitCode).toBe(1);
    expect(output).toHaveBeenCalledWith(expect.stringContaining(json ? '"ok": false' : "verification failed"));
    if (json) expect(output).toHaveBeenCalledWith(expect.stringContaining("Backup verification failed"));
  });

  it.each([false, true])("reports a verified backup (JSON: %s)", async (json) => {
    vi.mocked(verifySqliteBackup).mockReturnValue({ ok: true, activeCount: 1 });
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const program = buildTestProgram((p) => registerMemoryCommands(p));

    await program.parseAsync(["node", "test", "memory", "backup", ...(json ? ["--json"] : [])]);

    expect(process.exitCode).not.toBe(1);
    expect(output).toHaveBeenCalledWith(expect.stringContaining("/tmp/fixture-memory-backup.db"));
  });
});
