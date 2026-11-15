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

describe("run-goal read-back by a private id", () => {
  it("scopes the read with a subquery and never prints the id", () => {
    const section = execution.split("## Borrowed sessions and guards the gate skips")[1]?.split("\n## ")[0] ?? "";
    expect(section).toMatch(/Never print that id in chat/);
    expect(section).toMatch(/distinct_id IN \(SELECT distinct_id FROM/);
    expect(section).toMatch(/row by row, with\s+timestamps/);
  });

  it("has eval 321 for a send-versus-store count", () => {
    const fixture = evals.find(({ id }) => id === 321);
    expect(fixture?.prompt).toMatch(/install id is private/);
    expect(fixture?.expectations.join(" ")).toMatch(/Never prints the install id[\s\S]*subquery[\s\S]*timestamps/);
  });
});
