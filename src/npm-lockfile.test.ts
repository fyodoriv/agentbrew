import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..");
const packageLockPath = join(repoRoot, "package-lock.json");

describe("npm lockfile", () => {
  it("commits the npm lockfile for reproducible local installs", () => {
    expect(existsSync(packageLockPath)).toBe(true);
  });

  it("pins the local Biome platform package used on Apple Silicon", () => {
    const packageLock = JSON.parse(readFileSync(packageLockPath, "utf-8")) as {
      packages?: Record<string, { version?: string }>;
    };

    expect(packageLock.packages?.["node_modules/@biomejs/cli-darwin-arm64"]?.version).toBeDefined();
  });
});
