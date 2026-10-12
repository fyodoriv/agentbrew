/**
 * Run every wrapped rule linter against a repo (default: the cwd).
 *
 *   npx tsx scripts/run-rule-lints.ts [--json] [--repo=<path>]
 *
 * Exit 1 when any rule fails. Skipped rules (no Minsky checkout, or a
 * script too old for `--repo`) do not fail the run.
 */

import { resolve } from "node:path";
import type { RuleLintResult } from "../src/adapters/rule-lint.js";
import { MinskyRuleLint } from "../src/adapters/rule-lint.minsky.js";

const args = process.argv.slice(2);
const repoArg = args.find((arg) => arg.startsWith("--repo="));
const target = resolve(repoArg ? repoArg.slice("--repo=".length) : process.cwd());

const lint = new MinskyRuleLint();
const rules: RuleLintResult[] = [];
for (const ruleId of lint.ruleIds()) rules.push(await lint.run(ruleId, target));
const failed = rules.filter((rule) => rule.status === "fail");

if (args.includes("--json")) {
  process.stdout.write(`${JSON.stringify({ target, rules }, null, 2)}\n`);
} else {
  for (const rule of rules) {
    const mark = { pass: "✓", fail: "✗", skip: "-" }[rule.status];
    process.stdout.write(`${mark} ${rule.ruleId}: ${rule.detail.split("\n")[0] ?? ""}\n`);
    if (rule.status === "fail") process.stdout.write(`${rule.detail}\n`);
  }
  process.stdout.write(`rule-lints: ${rules.length - failed.length}/${rules.length} ok (skips count as ok)\n`);
}
process.exitCode = failed.length > 0 ? 1 : 0;
