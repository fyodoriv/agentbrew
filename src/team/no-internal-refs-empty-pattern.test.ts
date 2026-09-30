import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const TEST_PATH = join(REPO_ROOT, "src", "oss", "no-internal-refs.test.ts");

describe("OSS-readiness scanner", () => {
  it("exists as a generic internal-reference gate", () => {
    expect(existsSync(TEST_PATH)).toBe(true);
  });

  it("loads the private-reference pattern from environment or overlay config", () => {
    const content = readFileSync(TEST_PATH, "utf8");
    expect(content).toContain("OSS_READINESS_INTERNAL_PATTERN");
    expect(content).toContain("oss-readiness.env");
  });

  it("does not carry ratcheting allowlists in the base repo", () => {
    const content = readFileSync(TEST_PATH, "utf8");
    expect(content).not.toContain("TEMPORARY_ALLOWLIST");
    expect(content).not.toContain("PERMANENT_ALLOWLIST");
  });
});
