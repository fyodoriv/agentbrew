import { expect } from "vitest";

/** One entry of a skill's `evals/evals.json`, as the skill contract tests read it. */
export interface SkillEval {
  id: number | string;
  prompt: string;
  expected_output: string;
  expectations?: string[];
  assertions?: string[];
}

/** Assert that `text` contains every string term and matches every pattern; failures name the missing term. */
export function requireTerms(text: string, terms: Array<string | RegExp>): void {
  for (const term of terms) {
    if (typeof term === "string") {
      expect(text, `missing term: ${term}`).toContain(term);
    } else {
      expect(text, `missing pattern: ${term}`).toMatch(term);
    }
  }
}

/** Join an eval's `expectations` and `assertions` into one searchable string. */
export function expectationText(skillEval: SkillEval): string {
  return [...(skillEval.expectations ?? []), ...(skillEval.assertions ?? [])].join("\n");
}

/** Join an eval's prompt, expected output, and checks into one searchable string. */
export function scenarioText(skillEval: SkillEval): string {
  return [skillEval.prompt, skillEval.expected_output, expectationText(skillEval)].join("\n");
}

/**
 * Build `evalMatching(match)` for one skill's evals. It returns the first eval
 * whose scenario text matches `match`, and fails with the pattern when none does.
 */
export function evalMatcher(evals: SkillEval[]): (match: RegExp) => SkillEval {
  return (match) => {
    const found = evals.find((skillEval) => match.test(scenarioText(skillEval)));
    expect(found, `missing eval matching ${match}`).toBeDefined();
    return found as SkillEval;
  };
}
