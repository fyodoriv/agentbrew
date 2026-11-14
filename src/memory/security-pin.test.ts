import { describe, expect, it } from "vitest";
import { MEMORY_PINNED_SPEC } from "./constants.js";

describe("upstream memory security baseline", () => {
  it("does not select a version affected by the recorded origin and status advisories", () => {
    const version = /==(\d+)\.(\d+)\.(\d+)$/.exec(MEMORY_PINNED_SPEC);
    expect(version).not.toBeNull();
    const [major, minor] = version?.slice(1, 3).map(Number) ?? [];
    expect(major > 12 || (major === 12 && minor >= 9)).toBe(true);
  });
});
