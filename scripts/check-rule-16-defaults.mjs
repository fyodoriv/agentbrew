#!/usr/bin/env node
// <!-- scope: human-approved task adopt-rule-16-default-by-default (TASKS.md); this file closes it -->
// Rule 16 (default by default): every long CLI flag defined under src/ needs a
// row in docs/cli-flags-audit.md that says why it is not the default. A new
// flag without a row, a row for a flag that no longer exists, or an unknown
// category fails the check.
//
// Usage: node scripts/check-rule-16-defaults.mjs [--repo <dir>] [--json]

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const CATEGORIES = ["opt-out", "debug", "knob", "disruptive"];
const AUDIT = "docs/cli-flags-audit.md";
const OPTION_CALL = /\.(?:option|requiredOption)\(\s*["'`]([^"'`]+)["'`]/g;

/** Long flags (`--name`) declared through commander `.option()` calls. */
export function flagsInSource(text) {
  const flags = new Set();
  for (const match of text.matchAll(OPTION_CALL)) {
    const long = match[1].match(/--[a-z0-9][a-z0-9-]*/);
    if (long) flags.add(long[0]);
  }
  return flags;
}

/** Audit rows: flag → category. */
export function auditRows(text) {
  const rows = new Map();
  for (const line of text.split("\n")) {
    const match = line.match(/^\| `(--[a-z0-9-]+)` \| ([a-z-]+) \| (.+) \|$/);
    if (match) rows.set(match[1], { category: match[2], reason: match[3].trim() });
  }
  return rows;
}

export function compare(sourceFlags, rows) {
  const unjustified = [...sourceFlags].filter((flag) => !rows.has(flag)).sort();
  const stale = [...rows.keys()].filter((flag) => !sourceFlags.has(flag)).sort();
  const badCategory = [...rows]
    .filter(([, row]) => !CATEGORIES.includes(row.category) || row.reason.length < 3)
    .map(([flag]) => flag)
    .sort();
  return { unjustified_flags: unjustified, stale_rows: stale, bad_rows: badCategory };
}

function sourceFiles(repo) {
  return execFileSync("git", ["ls-files", "src"], { cwd: repo, encoding: "utf8" })
    .split("\n")
    .filter((file) => /\.ts$/.test(file) && !/\.test\.ts$/.test(file));
}

export function checkRepo(repo) {
  const flags = new Set();
  for (const file of sourceFiles(repo)) {
    for (const flag of flagsInSource(readFileSync(join(repo, file), "utf8"))) flags.add(flag);
  }
  const auditPath = join(repo, AUDIT);
  const rows = existsSync(auditPath) ? auditRows(readFileSync(auditPath, "utf8")) : new Map();
  return compare(flags, rows);
}

function main(argv) {
  const repoFlag = argv.indexOf("--repo");
  const repo = repoFlag >= 0 && argv[repoFlag + 1] ? argv[repoFlag + 1] : process.cwd();
  const result = checkRepo(repo);
  const failed = result.unjustified_flags.length + result.stale_rows.length + result.bad_rows.length > 0;
  if (argv.includes("--json")) {
    console.log(JSON.stringify(result));
  } else if (!failed) {
    console.log("rule-16 defaults: ok (every CLI flag says why it is not the default)");
  } else {
    console.error(`rule-16 defaults: update ${AUDIT}:`);
    for (const flag of result.unjustified_flags)
      console.error(`  ✗ ${flag}: new flag; add a row that says why it is not the default`);
    for (const flag of result.stale_rows) console.error(`  ✗ ${flag}: no longer in src/; remove its row`);
    for (const flag of result.bad_rows)
      console.error(`  ✗ ${flag}: category must be one of ${CATEGORIES.join(", ")}, with a reason`);
  }
  return failed ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main(process.argv.slice(2));
}
