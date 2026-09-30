import { beforeEach, describe, expect, it, vi } from "vitest";
import { warnIfDeprecated } from "./install.js";
import type { CatalogDeprecation } from "./types.js";

/**
 * Tests for the deprecation-warning surface added in PR for catalog-deprecation-markers (2026-05-26).
 *
 * The `CatalogDeprecation` schema field gets read at install time via
 * `warnIfDeprecated()` in `src/catalog/install.ts`, which emits a stderr
 * warning naming the deprecation date, reason, and replacement.
 *
 * Test strategy: spy on `console.error` (the warning target) and call the
 * exported `warnIfDeprecated` helper directly with synthetic entries. This
 * exercises the user-facing surface without dragging in the full
 * `installFromCatalog` mock harness, while still covering the contract the
 * 4 install branches depend on.
 */

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

/** Helper: concatenate all `console.error` arg-strings into one searchable blob. */
function capturedStderr(): string {
  return errorSpy.mock.calls.map((args: unknown[]) => args.map(String).join(" ")).join("\n");
}

describe("warnIfDeprecated", () => {
  it("emits nothing when entry has no `deprecated:` field", () => {
    warnIfDeprecated("context7", "MCP server", {
      /* no deprecated field */
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("emits nothing when entry.deprecated is explicitly undefined", () => {
    warnIfDeprecated("context7", "MCP server", { deprecated: undefined });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("warns with kind + name + since when entry is deprecated", () => {
    const deprecated: CatalogDeprecation = {
      since: "2026-05-26",
      reason: "Upstream archived the repo",
    };
    warnIfDeprecated("dead-skill", "skill", { deprecated });
    const stderr = capturedStderr();
    expect(stderr).toContain("dead-skill");
    expect(stderr).toContain("skill");
    expect(stderr).toContain("deprecated");
    expect(stderr).toContain("2026-05-26");
    expect(stderr).toContain("Upstream archived the repo");
  });

  it("names the replacement when provided as a catalog id", () => {
    const deprecated: CatalogDeprecation = {
      since: "2026-05-26",
      reason: "Replaced by the official upstream version",
      replacement: "context7",
    };
    warnIfDeprecated("legacy-context7", "MCP server", { deprecated });
    const stderr = capturedStderr();
    expect(stderr).toContain("Replacement:");
    expect(stderr).toContain("context7");
  });

  it("names the replacement when provided as a URL", () => {
    const deprecated: CatalogDeprecation = {
      since: "2026-05-26",
      reason: "Moved out of the catalog",
      replacement: "https://github.com/upstream/new-mcp",
    };
    warnIfDeprecated("legacy-mcp", "MCP server", { deprecated });
    const stderr = capturedStderr();
    expect(stderr).toContain("Replacement:");
    expect(stderr).toContain("https://github.com/upstream/new-mcp");
  });

  it("explicitly says 'none available' when no replacement is provided", () => {
    const deprecated: CatalogDeprecation = {
      since: "2026-05-26",
      reason: "Feature removed without replacement",
      // no replacement field
    };
    warnIfDeprecated("dead-end", "rule", { deprecated });
    const stderr = capturedStderr();
    expect(stderr).toContain("Replacement");
    expect(stderr).toContain("none available");
  });

  it("uses the `kind` argument in the header (skill / MCP server / rule / CLI tool)", () => {
    const deprecated: CatalogDeprecation = { since: "2026-05-26", reason: "test" };

    warnIfDeprecated("x", "skill", { deprecated });
    expect(capturedStderr()).toContain("skill 'x'");

    errorSpy.mockClear();
    warnIfDeprecated("x", "MCP server", { deprecated });
    expect(capturedStderr()).toContain("MCP server 'x'");

    errorSpy.mockClear();
    warnIfDeprecated("x", "rule", { deprecated });
    expect(capturedStderr()).toContain("rule 'x'");

    errorSpy.mockClear();
    warnIfDeprecated("x", "CLI tool", { deprecated });
    expect(capturedStderr()).toContain("CLI tool 'x'");
  });

  it("writes to stderr, NOT stdout (so structured-output consumers see it on a distinct channel)", () => {
    const stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const deprecated: CatalogDeprecation = { since: "2026-05-26", reason: "test" };
    warnIfDeprecated("x", "skill", { deprecated });
    expect(errorSpy).toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
    stdoutSpy.mockRestore();
  });
});

describe("CatalogDeprecation type round-trip via catalog.yaml", () => {
  // The schema is OPTIONAL on every catalog interface. To deprecate an
  // entry in production, an editor adds the inline YAML object to
  // `src/catalog.yaml` (or any overlay's `catalog-overlay.yaml`). This
  // test pins the shape so the YAML→type contract doesn't drift.

  it("type allows the minimal shape (since + reason only)", () => {
    const d: CatalogDeprecation = {
      since: "2026-05-26",
      reason: "Tested minimal shape",
    };
    expect(d.since).toBe("2026-05-26");
    expect(d.reason).toBe("Tested minimal shape");
    expect(d.replacement).toBeUndefined();
  });

  it("type allows the full shape (since + reason + replacement)", () => {
    const d: CatalogDeprecation = {
      since: "2026-05-26",
      reason: "Tested full shape",
      replacement: "successor-id",
    };
    expect(d.replacement).toBe("successor-id");
  });
});
