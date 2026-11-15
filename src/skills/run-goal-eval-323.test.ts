import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");
const execution = readFileSync(join(root, "references", "execution.md"), "utf8");
const evals = JSON.parse(readFileSync(join(root, "evals", "evals.json"), "utf8")).evals as Array<{
  id: number;
  prompt: string;
  expectations: string[];
}>;

describe("run-goal never bypasses the heavy-run queue", () => {
  it("keeps heavy gates queued even with the user's permission", () => {
    expect(execution).toMatch(/Never bypass `heavy-run`, even when the user permits it/);
    expect(execution).toMatch(/push the branch for hosted CI/);
  });

  it("has eval 323 for a permitted bypass while the queue waits", () => {
    const fixture = evals.find(({ id }) => id === 323);
    expect(fixture?.prompt).toMatch(/bypass the queue/);
    expect(fixture?.expectations.join(" ")).toMatch(/outside heavy-run, even with the user's permission/);
  });
});
