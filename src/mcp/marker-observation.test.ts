import { constants, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { observeMarker } from "./marker-observation.js";

describe("post-cleanup marker observation", () => {
  it("refuses unavailable safeguards before opening", () => {
    const open = vi.fn(() => {
      throw new Error("must not open");
    });
    for (const flags of [
      { O_NOFOLLOW: undefined, O_NONBLOCK: 1 },
      { O_NOFOLLOW: 1, O_NONBLOCK: undefined },
      { O_NOFOLLOW: 0, O_NONBLOCK: 1 },
      { O_NOFOLLOW: 1, O_NONBLOCK: 0 },
      { O_NOFOLLOW: Number.NaN, O_NONBLOCK: 2 },
      { O_NOFOLLOW: 1.5, O_NONBLOCK: 2 },
      { O_NOFOLLOW: -1, O_NONBLOCK: 2 },
      { O_NOFOLLOW: 2 ** 32, O_NONBLOCK: 2 },
      { O_NOFOLLOW: 2, O_NONBLOCK: 2 },
    ]) {
      expect(observeMarker("private-path", flags, open)).toBe("unreadable");
    }
    expect(open).not.toHaveBeenCalled();
  });
  it("returns closed states for missing, empty, nonempty and unsafe paths", () => {
    const nofollow = constants.O_NOFOLLOW;
    const nonblock = constants.O_NONBLOCK;
    if (
      !Number.isSafeInteger(nofollow) ||
      !Number.isSafeInteger(nonblock) ||
      nofollow <= 0 ||
      nonblock <= 0 ||
      nofollow > 0x7fffffff ||
      nonblock > 0x7fffffff ||
      (nofollow & nonblock) !== 0
    ) {
      const open = vi.fn(() => {
        throw new Error("must not open");
      });
      expect(observeMarker("private-path", constants, open)).toBe("unreadable");
      expect(open).not.toHaveBeenCalled();
      return;
    }
    const root = mkdtempSync(join(tmpdir(), "marker-observation-"));
    const canary = "private-fixture-content";
    try {
      const marker = join(root, "private-fixture-path");
      expect(observeMarker(marker)).toBe("missing");
      writeFileSync(marker, "");
      expect(observeMarker(marker)).toBe("empty");
      writeFileSync(marker, canary);
      expect(observeMarker(marker)).toBe("nonempty");
      const link = join(root, "link");
      symlinkSync(marker, link);
      expect(observeMarker(link)).toBe("unreadable");
      const directory = join(root, "directory");
      mkdirSync(directory);
      expect(observeMarker(directory)).toBe("unreadable");
      expect(JSON.stringify(observeMarker(marker))).not.toContain(canary);
      expect(JSON.stringify(observeMarker(marker))).not.toContain(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
