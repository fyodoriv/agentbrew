/** Retro 2026-10-28: a Monitor on the watch loop fails TLS in the sandbox; run the loop outside and tail its log. */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SKILL = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "watch-issues");
const evals = JSON.parse(readFileSync(join(SKILL, "evals", "evals.json"), "utf-8")).evals as Array<{
  id: number;
  prompt: string;
  expectations: string[];
}>;

describe("retro 2026-10-28 watch sandbox", () => {
  it("tells the agent to run the watch loop outside the sandbox and tail its log", () => {
    const text = readFileSync(join(SKILL, "SKILL.md"), "utf-8");
    expect(text).toMatch(/sandbox off, writing to a log/);
    expect(text).toMatch(/`tail -f` of\s+that log/);
  });

  it("has one eval for the x509 skip case and unique ids", () => {
    expect(evals.filter((e) => /x509/.test(e.prompt))).toHaveLength(1);
    const ids = evals.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
