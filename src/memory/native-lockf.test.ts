import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it.runIf(process.platform === "darwin")("keeps a descriptor lock until the Node owner closes it", () => {
  const dir = mkdtempSync(join(tmpdir(), "agentbrew-native-lock-"));
  const path = join(dir, "coordination.lock");
  try {
    const fd = openSync(path, "w+", 0o600);
    try {
      const first = spawnSync("/usr/bin/lockf", ["-t", "0", "3"], {
        stdio: ["ignore", "pipe", "pipe", fd],
        timeout: 10_000,
      });
      expect(first.status).toBe(0);
      const rival = spawnSync("/usr/bin/lockf", ["-k", "-t", "0", path, "/usr/bin/true"], { timeout: 10_000 });
      expect(rival.status).toBe(75);
    } finally {
      closeSync(fd);
    }
    const after = spawnSync("/usr/bin/lockf", ["-k", "-t", "0", path, "/usr/bin/true"], { timeout: 10_000 });
    expect(after.status).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
