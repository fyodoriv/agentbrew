#!/usr/bin/env node
// <!-- scope: human-approved task adopt-rule-8-pattern-conformance-index (TASKS.md); this file closes it -->
// Rule 8 (pattern conformance): every row of VISION.md "Pattern conformance
// index" names a real file, a known conformance value, and a pattern that the
// file's top-of-file `Pattern:` comment repeats. A deviation must be declared
// in the row, never left silent.
//
// Usage: node scripts/check-rule-8-pattern-conformance.mjs [--repo <dir>] [--json]

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const CONFORMANCE_VALUES = ["full", "partial", "declared deviation"];
export const MIN_ROWS = 15;
const SECTION = "## Pattern conformance index";

/** Parse the index table rows from VISION.md text. */
export function parseIndex(vision) {
  const start = vision.indexOf(SECTION);
  if (start < 0) return undefined;
  const rest = vision.slice(start + SECTION.length);
  const end = rest.search(/\n## /);
  const body = end < 0 ? rest : rest.slice(0, end);
  const rows = [];
  for (const line of body.split("\n")) {
    if (!line.startsWith("| `")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    rows.push({
      artifact: cells[0]?.replace(/^`|`$/g, "") ?? "",
      pattern: cells[1] ?? "",
      source: cells[2] ?? "",
      conformance: cells[3] ?? "",
    });
  }
  return rows;
}

/** Problems for one index row. */
function checkRow(repo, row) {
  const label = row.artifact || "(empty artifact)";
  const problems = [];
  if (!row.pattern) problems.push(`${label}: no pattern name`);
  if (!row.source) problems.push(`${label}: no source citation`);
  if (!CONFORMANCE_VALUES.includes(row.conformance)) {
    problems.push(`${label}: conformance "${row.conformance}" is not one of ${CONFORMANCE_VALUES.join(", ")}`);
  }
  const path = join(repo, row.artifact);
  if (!row.artifact || !existsSync(path)) return [...problems, `${label}: file does not exist`];
  if (/\.[cm]?[jt]s$/.test(row.artifact)) {
    const head = readFileSync(path, "utf8").split("\n").slice(0, 15).join("\n");
    if (!head.includes(`Pattern: ${row.pattern}`)) {
      problems.push(`${label}: top-of-file comment must say "Pattern: ${row.pattern}"`);
    }
  }
  return problems;
}

/** Return the problems for one repo root. */
export function checkRepo(repo) {
  const visionPath = join(repo, "VISION.md");
  if (!existsSync(visionPath)) return { rows: 0, problems: ["VISION.md not found"] };
  const rows = parseIndex(readFileSync(visionPath, "utf8"));
  if (!rows) return { rows: 0, problems: [`VISION.md has no "${SECTION}" section`] };
  const problems = rows.length < MIN_ROWS ? [`index has ${rows.length} rows; at least ${MIN_ROWS} are required`] : [];
  for (const row of rows) problems.push(...checkRow(repo, row));
  return { rows: rows.length, problems };
}

function main(argv) {
  const repoFlag = argv.indexOf("--repo");
  const repo = repoFlag >= 0 && argv[repoFlag + 1] ? argv[repoFlag + 1] : process.cwd();
  const result = checkRepo(repo);
  if (argv.includes("--json")) {
    console.log(JSON.stringify(result));
  } else if (result.problems.length === 0) {
    console.log(`rule-8 pattern conformance: ok (${result.rows} rows)`);
  } else {
    console.error('rule-8 pattern conformance: fix VISION.md "Pattern conformance index" or the file comment:');
    for (const problem of result.problems) console.error(`  ✗ ${problem}`);
  }
  return result.problems.length === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main(process.argv.slice(2));
}
