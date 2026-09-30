import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Recursively collects every file under `root` and returns their basenames.
 *
 * Used to resolve COMPETITION.md inline-code references like `` `patch.ts` ``
 * to a concrete file on disk. We only need the basename set because the
 * competition doc cites files by name, not path.
 */
export function collectSrcFilenames(root: string): Set<string> {
  const names = new Set<string>();
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const fullPath = join(directory, entry);
      const stats = statSync(fullPath);
      if (stats.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (stats.isFile()) {
        names.add(entry);
      }
    }
  };
  walk(root);
  return names;
}

/**
 * A COMPETITION.md "Recently Closed Gaps" row whose file claim cannot be found
 * in `src/`. Reported per-file so reviewers see exactly which claim to fix.
 */
interface GapClaimViolation {
  gapNumber: string;
  filename: string;
  rowSnippet: string;
}

const rowsSectionHeader = "### Recently Closed Gaps";
const rowsSectionEnd = "### Remaining Gaps";

/**
 * Skipping rules:
 * - `Claim disputed` rows are already flagged and explain their own miss.
 * - `⚠ Deleted` or `(deleted YYYY-MM)` rows describe files intentionally removed.
 * - `(deleted 2026-MM)` inline markers on individual mentions are treated the
 *   same — if the row narrates a deletion, no cited `.ts` file is expected to
 *   exist.
 */
function isRowSkippable(row: string): boolean {
  return /Claim disputed|Deleted|deleted \d{4}-/u.test(row);
}

const filenameRe = /`([A-Za-z0-9_-]+\.(?:ts|tsx))`/gu;

function extractGapNumber(row: string): string {
  const match = row.match(/^\|\s*([^|]+?)\s*\|/u);
  return match?.[1]?.trim() ?? "?";
}

/**
 * Finds COMPETITION.md "Recently Closed Gaps" rows whose inline `file.ts`
 * citations do not resolve to any file under `src/`. Rows already flagged as
 * disputed or deleted are skipped. Returns one entry per unresolved filename
 * (not per row) so reviewers can audit each claim independently.
 */
export function findMissingGapClaims(markdown: string, srcFilenames: Set<string>): GapClaimViolation[] {
  const start = markdown.indexOf(rowsSectionHeader);
  if (start === -1) {
    return [];
  }
  const end = markdown.indexOf(rowsSectionEnd, start);
  const section = end === -1 ? markdown.slice(start) : markdown.slice(start, end);
  const rows = section.split("\n").filter((line) => line.startsWith("|") && !line.startsWith("|---"));

  const violations: GapClaimViolation[] = [];
  for (const row of rows) {
    if (row.includes("| Gap |") || isRowSkippable(row)) {
      continue;
    }
    const gapNumber = extractGapNumber(row);
    for (const match of row.matchAll(filenameRe)) {
      const filename = match[1];
      if (srcFilenames.has(filename)) {
        continue;
      }
      violations.push({ gapNumber, filename, rowSnippet: row.slice(0, 160) });
    }
  }
  return violations;
}

/**
 * Verifies COMPETITION.md's "Recently Closed Gaps" section against the
 * filesystem at `srcRoot`. Throws if any active (non-disputed, non-deleted)
 * row cites a `file.ts` / `file.tsx` that does not exist. Used by
 * `scripts/verify-competition-claims.ts` and the matching vitest spec.
 */
export function verifyCompetitionClaims(competitionDocPath: string, srcRoot: string): void {
  const markdown = readFileSync(competitionDocPath, "utf-8");
  const srcFilenames = collectSrcFilenames(srcRoot);
  const violations = findMissingGapClaims(markdown, srcFilenames);
  if (violations.length === 0) {
    return;
  }
  const lines = violations.map(
    (v) => `  - row ${v.gapNumber} cites \`${v.filename}\` which does not exist in \`${srcRoot}\``,
  );
  throw new Error(["COMPETITION.md Gap Analysis cites files that are not in the codebase:", ...lines].join("\n"));
}
