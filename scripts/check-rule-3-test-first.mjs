#!/usr/bin/env node
// Rule 3, test-first half: a branch that changes behavior code under `src/`
// must also change a test, or carry a `Test exemption: <reason>` line in a
// commit message. The doc-first half runs through Minsky's
// check-rule-3-doc-first.mjs in `npm run lint:rules`.
//
// The diff is the working tree (committed, staged, unstaged, and untracked
// files) against the merge base with the base ref. Base ref: `--base <ref>`,
// else $TEST_FIRST_BASE, else origin/main. With no merge base (for example a
// clone without that ref), the check skips and exits 0.
//
// Usage: node scripts/check-rule-3-test-first.mjs [--base <ref>]

import { execFileSync } from "node:child_process";

const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?$|\.test\.sh$|\.bats$|(^|\/)evals\/)/;
const BEHAVIOR_FILE = /^src\/.+\.[cm]?[jt]sx?$/;
const EXEMPTION = /^Test exemption:[ \t]*\S.{2,}$/im;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function lines(text) {
  return text ? text.split("\n").filter(Boolean) : [];
}

function baseRef(argv) {
  const flag = argv.indexOf("--base");
  if (flag >= 0 && argv[flag + 1]) return argv[flag + 1];
  return process.env.TEST_FIRST_BASE || "origin/main";
}

function main() {
  const ref = baseRef(process.argv.slice(2));
  let mergeBase;
  try {
    mergeBase = git(["merge-base", ref, "HEAD"]);
  } catch {
    console.log(`rule-3 test-first: skipped (no merge base with ${ref})`);
    return 0;
  }

  const changed = new Set([
    ...lines(git(["diff", "--name-only", mergeBase])),
    ...lines(git(["ls-files", "--others", "--exclude-standard"])),
  ]);
  const behavior = [...changed].filter((path) => BEHAVIOR_FILE.test(path) && !TEST_FILE.test(path));
  if (behavior.length === 0) {
    console.log("rule-3 test-first: ok (no behavior change under src/)");
    return 0;
  }
  if ([...changed].some((path) => TEST_FILE.test(path))) {
    console.log("rule-3 test-first: ok (behavior change ships with a test diff)");
    return 0;
  }
  if (EXEMPTION.test(git(["log", "--format=%B", `${mergeBase}..HEAD`]))) {
    console.log("rule-3 test-first: ok (a commit message has a Test exemption line)");
    return 0;
  }

  console.error("rule-3 test-first: behavior changed under src/ with no test diff:");
  for (const path of behavior.sort()) console.error(`  - ${path}`);
  console.error("Add or change a test, or add a 'Test exemption: <reason>' line to a commit message.");
  return 1;
}

process.exit(main());
