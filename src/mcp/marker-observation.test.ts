import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { observeMarker } from "./marker-observation.js";

describe("post-cleanup marker observation", () => {
  it("returns closed states for missing, empty, nonempty and unsafe paths", () => {
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
