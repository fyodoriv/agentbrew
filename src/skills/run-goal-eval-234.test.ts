import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");
const evals = JSON.parse(readFileSync(join(root, "evals", "evals.json"), "utf8")).evals as Array<{
  id: number;
  prompt: string;
  expected_output: string;
  expectations: string[];
}>;
const scenario = () => evals.find(({ id }) => id === 234);
const expectations = () => [scenario()?.expected_output, ...(scenario()?.expectations ?? [])].join(" ");

describe("run-goal requested delivery session (#775)", () => {
  it("supplies owned open PRs across related repos and links for one scoped chat", () => {
    const fixture = scenario();
    expect(fixture).toBeDefined();
    const raw = /PR inventory fixture:\n```json\n([\s\S]+?)\n```/.exec(fixture?.prompt ?? "");
    expect(raw).not.toBeNull();
    const inventory = JSON.parse(raw?.[1] ?? "{}") as {
      relatedRepos: string[];
      open: Array<{ repo: string; number: number; authoredByUser: boolean; url: string }>;
    };
    const owned = inventory.open.filter((pr) => pr.authoredByUser && inventory.relatedRepos.includes(pr.repo));
    expect(owned.map(({ number }) => number)).toEqual([11, 12, 21]);
    expect(new Set(owned.map(({ repo }) => repo)).size).toBe(2);
    expect(owned.every(({ url, number }) => url.endsWith(`/pull/${number}`))).toBe(true);
    expect(expectations()).toMatch(/one new[^.]*chat[\s\S]*each PR[^.]*link/i);
    expect(expectations()).toMatch(/all[^.]*user-authored[^.]*open PRs[\s\S]*related repos/i);
  });

  it("coordinates existing chats before transferring ownership without creating duplicates", () => {
    expect(scenario()).toBeDefined();
    expect(expectations()).toMatch(/existing chats[\s\S]*handoff/i);
    expect(expectations()).toMatch(/acknowledg[\s\S]*release[\s\S]*before[\s\S]*delivery/i);
    expect(expectations()).toMatch(/does not[\s\S]*second chat[\s\S]*evade/i);
    expect(expectations()).toMatch(/unavailable[\s\S]*does not claim[\s\S]*created/i);
  });

  it("requires authoritative terminal or missing-handle evidence before retiring only the stale record", () => {
    expect(scenario()).toBeDefined();
    expect(scenario()?.prompt).toMatch(
      /status timeout[\s\S]*authoritative terminal[\s\S]*authoritative missing handle/i,
    );
    expect(expectations()).toMatch(/timeout[\s\S]*unknown[\s\S]*not[^.]*dead/i);
    expect(expectations()).toMatch(/authoritative[^.]*terminal[\s\S]*missing handle/i);
    expect(expectations()).toMatch(/only the stale record[\s\S]*handoff note[\s\S]*bind/i);
    expect(expectations()).toMatch(/never[^.]*force[^.]*registry/i);
  });
});
