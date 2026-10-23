/** Command and agent name clashes: the source listed later wins, and status names it. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentBrewState } from "../types.js";
import { agentNameClashes, commandNameClashes, nameClashes } from "./name-clashes.js";

const made: string[] = [];
function dirWith(...files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "name-clash-"));
  made.push(dir);
  mkdirSync(dir, { recursive: true });
  for (const f of files) writeFileSync(join(dir, f), `# ${f}\n`);
  return dir;
}
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

const state = (key: "commandSourceDirs" | "agentSourceDirs", dirs: string[]): AgentBrewState =>
  ({
    agents: [],
    catalogVersion: "test",
    [key]: dirs.map((path, i) => ({ label: `src${i}`, path })),
  }) as AgentBrewState;

describe("nameClashes", () => {
  it("the source listed later wins, in both orders", () => {
    const a = { label: "a", names: ["review", "only-a"] };
    const b = { label: "b", names: ["review"] };
    expect(nameClashes([a, b])).toEqual([{ name: "review", owner: "b", skipped: ["a"] }]);
    expect(nameClashes([b, a])).toEqual([{ name: "review", owner: "a", skipped: ["b"] }]);
  });
});

describe("commandNameClashes and agentNameClashes", () => {
  it("name a command clash between two command source dirs, the later one winning", () => {
    const one = dirWith("review.md", "a.md");
    const two = dirWith("review.md");
    expect(commandNameClashes(state("commandSourceDirs", [one, two]))).toEqual([
      { name: "review", owner: two, skipped: [one] },
    ]);
  });

  it("name an agent clash between two agent source dirs, the later one winning", () => {
    const one = dirWith("reviewer.md");
    const two = dirWith("reviewer.md", "planner.md");
    expect(agentNameClashes(state("agentSourceDirs", [two, one]))).toEqual([
      { name: "reviewer", owner: one, skipped: [two] },
    ]);
  });

  it("count a dir listed twice once, so it never clashes with itself", () => {
    const one = dirWith("review.md");
    expect(commandNameClashes(state("commandSourceDirs", [one, one]))).toEqual([]);
  });

  it("return nothing when names do not clash or a dir is missing", () => {
    const one = dirWith("a.md");
    expect(commandNameClashes(state("commandSourceDirs", [one, join(one, "missing")]))).toEqual([]);
  });
});
