import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { collectSrcFilenames, findMissingGapClaims, verifyCompetitionClaims } from "./gap-claims.js";

describe("findMissingGapClaims", () => {
  it("flags rows that cite a .ts file missing from src/", () => {
    const markdown = [
      "### Recently Closed Gaps ✅",
      "",
      "| # | Gap | Closed How | When |",
      "|---|-----|-----------|------|",
      "| 1 | ~~Real feature~~ | `real-file.ts` — ships | 2026-03 |",
      "| 2 | ~~Ghost feature~~ | `fake-file.ts` — ships | 2026-03 |",
      "",
      "### Remaining Gaps",
    ].join("\n");

    const violations = findMissingGapClaims(markdown, new Set(["real-file.ts"]));
    expect(violations).toEqual([
      { gapNumber: "2", filename: "fake-file.ts", rowSnippet: expect.stringContaining("Ghost feature") },
    ]);
  });

  it("skips rows flagged as claim disputed", () => {
    const markdown = [
      "### Recently Closed Gaps ✅",
      "",
      "| # | Gap | Closed How | When |",
      "|---|-----|-----------|------|",
      "| 1e | **⚠ Claim disputed — `patch.ts` does not exist in `src/`** | prior art | 2026-04-19 |",
      "",
      "### Remaining Gaps",
    ].join("\n");

    expect(findMissingGapClaims(markdown, new Set())).toEqual([]);
  });

  it("skips rows flagged as deleted", () => {
    const markdown = [
      "### Recently Closed Gaps ✅",
      "",
      "| # | Gap | Closed How | When |",
      "|---|-----|-----------|------|",
      "| 12 | **⚠ Deleted 2026-04-24 — broken on common filesystems.** `usage.ts` removed | 2026-04-24 |",
      "",
      "### Remaining Gaps",
    ].join("\n");

    expect(findMissingGapClaims(markdown, new Set())).toEqual([]);
  });

  it("skips rows whose cell marks an inline (deleted YYYY-MM) parenthetical", () => {
    const markdown = [
      "### Recently Closed Gaps ✅",
      "",
      "| # | Gap | Closed How | When |",
      "|---|-----|-----------|------|",
      "| 8 | ~~Skill scenarios / groups~~ | `scenario.ts` — switch skill sets per workflow (deleted 2026-03) | 2026-03 |",
      "",
      "### Remaining Gaps",
    ].join("\n");

    expect(findMissingGapClaims(markdown, new Set())).toEqual([]);
  });

  it("ignores non-.ts/.tsx citations like config paths", () => {
    const markdown = [
      "### Recently Closed Gaps ✅",
      "",
      "| # | Gap | Closed How | When |",
      "|---|-----|-----------|------|",
      "| 5 | ~~Per-project config~~ | `.agentbrew.yaml` per-project config | 2026-02 |",
      "",
      "### Remaining Gaps",
    ].join("\n");

    expect(findMissingGapClaims(markdown, new Set())).toEqual([]);
  });

  it("ignores non-active sections outside the Recently Closed Gaps header", () => {
    const markdown = ["## Summary", "", "The `missing.ts` file powers everything.", "", "### Remaining Gaps"].join(
      "\n",
    );

    expect(findMissingGapClaims(markdown, new Set())).toEqual([]);
  });
});

describe("verifyCompetitionClaims — integration", () => {
  it("passes against the real docs/COMPETITION.md + src/ tree", () => {
    const repoRoot = resolve(import.meta.dirname, "..", "..");
    expect(() =>
      verifyCompetitionClaims(join(repoRoot, "docs", "COMPETITION.md"), join(repoRoot, "src")),
    ).not.toThrow();
  });

  it("throws with a clear error when a synthetic fake-file.ts row is injected", () => {
    const directory = mkdtempSync(join(tmpdir(), "gap-claims-"));
    const srcRoot = join(directory, "src");
    mkdirSync(srcRoot, { recursive: true });
    writeFileSync(join(srcRoot, "keep.ts"), "export {};\n", "utf8");
    const competitionDocPath = join(directory, "COMPETITION.md");
    writeFileSync(
      competitionDocPath,
      [
        "### Recently Closed Gaps ✅",
        "",
        "| # | Gap | Closed How | When |",
        "|---|-----|-----------|------|",
        "| 99 | ~~Fake~~ | `fake-file.ts` — ships | 2026-03 |",
        "",
        "### Remaining Gaps",
      ].join("\n"),
      "utf8",
    );
    expect(() => verifyCompetitionClaims(competitionDocPath, srcRoot)).toThrowError(/row 99 cites `fake-file.ts`/u);
  });
});

describe("collectSrcFilenames", () => {
  it("returns the basename of every file under the root, recursively", () => {
    const directory = mkdtempSync(join(tmpdir(), "collect-src-"));
    mkdirSync(join(directory, "nested"));
    writeFileSync(join(directory, "top.ts"), "export {};\n", "utf8");
    writeFileSync(join(directory, "nested", "inner.ts"), "export {};\n", "utf8");
    const names = collectSrcFilenames(directory);
    expect(names.has("top.ts")).toBe(true);
    expect(names.has("inner.ts")).toBe(true);
  });
});
