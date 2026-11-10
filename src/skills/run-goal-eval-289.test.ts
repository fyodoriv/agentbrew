import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");
const execution = readFileSync(join(root, "references", "execution.md"), "utf8");
const hosted = execution.split("## Hosted checks\n")[1]?.split("\n## ")[0] ?? "";
const evals = JSON.parse(readFileSync(join(root, "evals", "evals.json"), "utf8")).evals as Array<{
  id: number;
  prompt: string;
  expected_output: string;
  expectations: string[];
}>;
const scenario = () => evals.find(({ id }) => id === 289);
const expectations = () => [scenario()?.expected_output, ...(scenario()?.expectations ?? [])].join(" ");

describe("run-goal hosted failure that the runner's own settings cause", () => {
  it("tells the agent to set the workflow env block and a clean git config locally", () => {
    expect(hosted).toMatch(/each `env:` block of the workflow[\s\S]*set every variable/i);
    expect(hosted).toMatch(/CI=true[\s\S]*GITHUB_ACTIONS=true/);
    expect(hosted).toMatch(/GIT_CONFIG_GLOBAL[\s\S]*GIT_CONFIG_NOSYSTEM=1/);
  });

  it("keeps a blocker handed to another session with the agent", () => {
    expect(hosted).toMatch(/handed to another session is still yours/i);
    expect(hosted).toMatch(/tell that session you take the blocker back/i);
    expect(hosted).toMatch(/tell that session what you\s+fixed/i);
  });

  it("has an eval whose failure survives env -i and whose peer session brings no fix", () => {
    const fixture = scenario();
    expect(fixture).toBeDefined();
    expect(fixture?.prompt).toMatch(/also with `env -i`/);
    expect(fixture?.prompt).toMatch(/names no fix/);
    expect(expectations()).toMatch(/env block/i);
    expect(expectations()).toMatch(/clean git config/i);
    expect(expectations()).toMatch(/no duplicate fix|no second fix/i);
    expect(expectations()).toMatch(/does not merge/i);
  });
});
