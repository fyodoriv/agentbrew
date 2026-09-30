import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveMemoryPackPaths } from "./pack-paths.js";

describe("resolveMemoryPackPaths", () => {
  it("resolves only directories containing pack.yaml", () => {
    const root = join(tmpdir(), `agentbrew-pack-paths-${process.pid}`);
    mkdirSync(root, { recursive: true });
    const valid = join(root, "valid-pack");
    const invalid = join(root, "missing-manifest");
    mkdirSync(valid, { recursive: true });
    mkdirSync(invalid, { recursive: true });
    writeFileSync(join(valid, "pack.yaml"), "id: demo\n", "utf-8");
    try {
      expect(resolveMemoryPackPaths(root, ["valid-pack", "missing-manifest"])).toEqual([valid]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns empty when no entries resolve", () => {
    if (!existsSync("/tmp/agentbrew-no-such-pack-dir")) {
      expect(resolveMemoryPackPaths("/tmp", ["agentbrew-no-such-pack-dir"])).toEqual([]);
    }
  });
});
