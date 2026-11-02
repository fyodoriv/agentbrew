import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expectationText, requireTerms, type SkillEval } from "./skill-contract-test-helpers.js";

const skillDir = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");
const evals = JSON.parse(readFileSync(join(skillDir, "evals", "evals.json"), "utf-8")).evals as SkillEval[];
function requiredEval(id: number): SkillEval {
  const matches = evals.filter((entry) => entry.id === id);
  if (matches.length !== 1 || typeof matches[0].prompt !== "string") {
    throw new Error(`Eval ${id} setup requires exactly one entry with a prompt`);
  }
  return matches[0];
}
const recovery = requiredEval(214);
const cleanup = requiredEval(215);

describe("run-goal eval 214 prompt-only input contract", () => {
  it("214-1 supplies the first timeout, unknown commit and lost returned IDs", () => {
    requireTerms(recovery.prompt, [
      /first write[^.]*timed out/i,
      /commit outcome[^.]*unknown/i,
      /returned IDs[^.]*lost/i,
    ]);
  });

  it("214-2 supplies the landed owned row and the missing schedule item", () => {
    requireTerms(recovery.prompt, [
      /target snapshot[^.]*owned-kitchen/i,
      /owned-kitchen[^.]*landed/i,
      /bathroom[^.]*missing/i,
    ]);
  });

  it("214-3 supplies observable ownership identity on each attempted item", () => {
    requireTerms(recovery.prompt, [
      /each attempted item[^.]*owned-list ID[^.]*schedule-source key[^.]*occurrence date/i,
      /owned-list ID[^.]*owned-cleaning/i,
      /schedule-source keys?[^.]*kitchen[^.]*bathroom/i,
      /occurrence date[^.]*2030-04-12/i,
      /target snapshot[^.]*ownership fields/i,
    ]);
  });

  it("214-4 distinguishes kitchen and bathroom from foreign-dentist with exact minutes", () => {
    requireTerms(recovery.prompt, [
      /kitchen[^.]*2030-04-12[^.]*20 minutes/i,
      /bathroom[^.]*2030-04-12[^.]*30 minutes/i,
      /foreign-dentist[^.]*2030-04-12[^.]*protected/i,
      /foreign-dentist[^.]*not owned/i,
    ]);
  });

  it("214-5 supplies per-item checkpoints and second-timeout reconciliation", () => {
    requireTerms(recovery.prompt, [
      /save[^.]*progress[^.]*per item/i,
      /second write[^.]*timed out/i,
      /second[^.]*commit outcome[^.]*unknown/i,
      /reconciliation snapshot[^.]*owned-bathroom[^.]*landed/i,
      /checkpoint[^.]*owned-kitchen[^.]*preserved/i,
    ]);
  });

  it("214-6 requires fresh exact readback and preservation of identities, minutes and foreign records", () => {
    requireTerms(recovery.prompt, [
      /fresh[^.]*readback/i,
      /exactly one[^.]*owned[^.]*kitchen[^.]*bathroom/i,
      /no duplicate owned identities/i,
      /kitchen[^.]*20 minutes[^.]*bathroom[^.]*30 minutes/i,
      /foreign-dentist[^.]*unchanged/i,
    ]);
  });
});

describe("run-goal eval 215 prompt-only input contract", () => {
  it("215-1 supplies the owned archive and stable authorized and protected IDs", () => {
    requireTerms(cleanup.prompt, [
      /archive snapshot[^.]*cleaning-archive/i,
      /authorized[^.]*repeat-kitchen[^.]*repeat-bathroom[^.]*duplicate-kitchen[^.]*duplicate-bathroom/i,
      /foreign-dentist[^.]*protected[^.]*not authorized/i,
      /foreign-dentist[^.]*cleaning-archive/i,
    ]);
  });

  it("215-2 supplies individual recovery correspondence for every cleanup target", () => {
    requireTerms(cleanup.prompt, [
      /repeat-kitchen[^.]*backup-kitchen/i,
      /repeat-bathroom[^.]*backup-bathroom/i,
      /duplicate-kitchen[^.]*live-kitchen/i,
      /duplicate-bathroom[^.]*live-bathroom/i,
      /counts alone[^.]*insufficient/i,
    ]);
  });

  it("215-3 supplies recurring and nonrecurring identities with exact initial counts", () => {
    requireTerms(cleanup.prompt, [
      /recurring IDs[^.]*repeat-kitchen[^.]*repeat-bathroom/i,
      /nonrecurring IDs[^.]*duplicate-kitchen[^.]*duplicate-bathroom/i,
      /initial counts[^.]*2 recurring[^.]*2 nonrecurring[^.]*1 protected/i,
    ]);
  });

  it("215-4 supplies a single-item rollover response that retains the recurring ID", () => {
    requireTerms(cleanup.prompt, [
      /single-item probe[^.]*repeat-kitchen/i,
      /probe response[^.]*repeat-kitchen[^.]*retained/i,
      /2030-04-12[^.]*2030-04-19/i,
      /not removed/i,
    ]);
  });

  it("215-5 restricts authorization to nonrecurring completion and forbids permanent deletion", () => {
    requireTerms(cleanup.prompt, [
      /only[^.]*nonrecurring duplicates[^.]*complet/i,
      /further recurring completion[^.]*forbidden/i,
      /agent permanent deletion[^.]*forbidden/i,
      /do not[^.]*delete[^.]*archive list/i,
    ]);
  });

  it("215-6 requires fresh distinct final counts and a partial result with protected records preserved", () => {
    requireTerms(cleanup.prompt, [
      /fresh[^.]*readback/i,
      /2 remaining recurring[^.]*2 completed nonrecurring[^.]*1 protected/i,
      /foreign-dentist[^.]*unchanged/i,
      /partly met[^.]*not complete/i,
      /2 unresolved recurring/i,
    ]);
  });
});

describe("run-goal evals 214-215 expected-answer consistency", () => {
  it("does not adopt records by due date alone or collapse same-date source entries", () => {
    const answer = `${recovery.expected_output}\n${expectationText(recovery)}`;
    expect(answer).not.toMatch(/stable key\s*\(due date\)/i);
    requireTerms(answer, [
      /owned-list ID[^.]*schedule-source key[^.]*occurrence date/i,
      /due date alone[^.]*(?:insufficient|not|never)/i,
      /same-date[^.]*distinct/i,
      /foreign[^.]*unchanged/i,
    ]);
  });

  it("keeps cleanup partial and does not recommend deleting an archive with a protected member", () => {
    const answer = `${cleanup.expected_output}\n${expectationText(cleanup)}`;
    requireTerms(answer, [
      /nonrecurring[^.]*complet/i,
      /recurring[^.]*roll/i,
      /partly met/i,
      /fresh[^.]*readback/i,
      /do not[^.]*delete[^.]*archive list/i,
      /protected[^.]*unchanged/i,
    ]);
    expect(answer).not.toMatch(/one-step user action\s*\(delete the archive list\)/i);
    expect(answer).not.toMatch(/hands the delete step to the user/i);
  });

  it("retains unique eval IDs, including exactly one 214 and one 215", () => {
    const ids = evals.map((entry) => String(entry.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(evals.filter((entry) => entry.id === 214)).toHaveLength(1);
    expect(evals.filter((entry) => entry.id === 215)).toHaveLength(1);
  });
});
