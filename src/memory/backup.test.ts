import { describe, expect, it } from "vitest";
import { backupAgeSec, backupIsFresh, newestBackupInDir } from "./backup.js";

describe("memory backup helpers", () => {
  it("reports backup age from mtime", () => {
    const now = 1_700_000_000;
    expect(backupAgeSec("/missing", now)).toBeUndefined();
    expect(backupIsFresh("/missing", 3600, now)).toBe(false);
  });

  it("returns undefined when backup directory is missing", () => {
    expect(newestBackupInDir("/path/that/does/not/exist/agentbrew-memory-backups")).toBeUndefined();
  });
});
