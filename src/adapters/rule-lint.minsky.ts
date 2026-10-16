// Pattern: Ports and Adapters (Cockburn 2005, "Hexagonal Architecture"). See VISION.md "Pattern conformance index".
/**
 * Runs Minsky's `scripts/check-rule-*.mjs` linters against another repo
 * with `--repo=<target>`. Minsky is found through `AGENTBREW_MINSKY_DIR`,
 * else `~/apps/tooling/minsky`. When the checkout or a script is missing,
 * or the script is too old to accept `--repo`, the rule is skipped, never
 * failed: a machine without Minsky still passes `npm run verify`.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RuleLint, RuleLintResult } from "./rule-lint.js";

const execFileAsync = promisify(execFile);

/** Rule id → Minsky script. Only scripts that read the target from `--repo`. */
const MINSKY_RULE_SCRIPTS: Readonly<Record<string, string>> = Object.freeze({
  "rule-1": "check-rule-1-novel-justification.mjs",
  "rule-3": "check-rule-3-doc-first.mjs",
  "rule-4": "check-rule-4-otel-coverage.mjs",
  "rule-6": "check-rule-6-let-it-crash.mjs",
  "rule-9": "check-rule-9-tasksmd-fields.mjs",
  "rule-12": "check-rule-12-scope-discipline.mjs",
  "rule-13": "check-rule-13-sibling-anchors.mjs",
  "rule-17": "check-rule-17-proactive-heal.mjs",
});

const DETAIL_LINES = 6;
/** Text that only appears in scripts that parse `--repo` (inline or via Minsky's repo-arg helper). */
const REPO_FLAG_MARKER = /--repo|"repo"|repo-arg/;

export function defaultMinskyDir(): string {
  return process.env.AGENTBREW_MINSKY_DIR ?? join(homedir(), "apps", "tooling", "minsky");
}

function firstLines(text: string): string {
  return text.split("\n").filter(Boolean).slice(0, DETAIL_LINES).join("\n");
}

export class MinskyRuleLint implements RuleLint {
  constructor(private readonly minskyDir: string = defaultMinskyDir()) {}

  ruleIds(): readonly string[] {
    return Object.keys(MINSKY_RULE_SCRIPTS);
  }

  async run(ruleId: string, target: string): Promise<RuleLintResult> {
    const script = MINSKY_RULE_SCRIPTS[ruleId];
    if (!script) return { ruleId, status: "skip", detail: `unknown rule id ${ruleId}` };
    const path = join(this.minskyDir, "scripts", script);
    if (!existsSync(path)) return { ruleId, status: "skip", detail: `Minsky script not found: ${path}` };
    // An old script ignores --repo and would check Minsky's own tree instead.
    if (!REPO_FLAG_MARKER.test(readFileSync(path, "utf-8"))) {
      return { ruleId, status: "skip", detail: `${script} does not accept --repo; update the Minsky checkout` };
    }
    try {
      const { stdout, stderr } = await execFileAsync(process.execPath, [path, `--repo=${target}`], {
        cwd: target,
        maxBuffer: 4 * 1024 * 1024,
      });
      return { ruleId, status: "pass", detail: firstLines(`${stdout}${stderr}`) };
    } catch (error) {
      const failed = error as { code?: unknown; stdout?: string; stderr?: string; message?: string };
      if (typeof failed.code !== "number") {
        return { ruleId, status: "skip", detail: `could not run ${script}: ${failed.message ?? String(error)}` };
      }
      return { ruleId, status: "fail", detail: firstLines(`${failed.stdout ?? ""}${failed.stderr ?? ""}`) };
    }
  }

  /** Adapter self-test: run rule 9 against `target` and report the result. */
  async selfTest(target: string): Promise<RuleLintResult> {
    return this.run("rule-9", target);
  }
}
