import type { Reporter } from "vitest/reporters";

export const OUTCOME_PREFIX = "lifecycle-test-outcome ";
export const STDERR_COMPLETE = "lifecycle-stderr-complete";

type RunEnd = NonNullable<Reporter["onTestRunEnd"]>;

export default class LifecycleObservationReporter implements Reporter {
  onTestRunEnd(...[modules, unhandledErrors, reason]: Parameters<RunEnd>) {
    if (modules.length !== 1 || unhandledErrors.length !== 0 || reason === "interrupted") return;
    const executed = [...modules[0].children.allTests()]
      .map((test) => test.result())
      .filter((r) => r.state !== "skipped");
    const [result] = executed;
    if (executed.length !== 1 || result.state !== reason) return;
    const errors = result.errors ?? [];
    if (result.state === "passed" && errors.length === 0) {
      this.writeOutcome("passed");
    } else if (result.state === "failed" && errors.length === 1 && typeof errors[0].message === "string") {
      const match = /^Test timed out in ([1-9]\d*)ms\.(?:\n|$)/.exec(errors[0].message);
      this.writeOutcome(match ? `timed-out ${match[1]}` : "failed");
    }
  }

  private writeOutcome(outcome: string) {
    process.stdout.write(`${OUTCOME_PREFIX}${outcome}\n`);
    process.stderr.write(`${STDERR_COMPLETE}\n`);
  }
}
