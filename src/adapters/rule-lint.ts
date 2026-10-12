/**
 * Rule-lint adapter interface: run one deterministic rule check against a
 * repo and report pass, fail, or skip. agentbrew wraps existing rule
 * linters (today: Minsky's `scripts/check-rule-*.mjs`) instead of
 * reimplementing them.
 */

export interface RuleLintResult {
  ruleId: string;
  /** "pass" and "fail" come from the linter's exit code; "skip" means it could not run here. */
  status: "pass" | "fail" | "skip";
  /** First lines of the linter's output, or the skip reason. */
  detail: string;
}

export interface RuleLint {
  /** Rule ids this adapter can run, in report order. */
  ruleIds(): readonly string[];
  run(ruleId: string, target: string): Promise<RuleLintResult>;
}
