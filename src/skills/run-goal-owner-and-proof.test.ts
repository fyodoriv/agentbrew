import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { requireTerms, type SkillEval } from "./skill-contract-test-helpers.js";
import { validateEvals } from "./validate.js";

const root = join(resolve(import.meta.dirname, "..", ".."), "skill-plugins", "workflow", "run-goal");
const skill = readFileSync(join(root, "SKILL.md"), "utf8");
const evals = JSON.parse(readFileSync(join(root, "evals", "evals.json"), "utf8")).evals as SkillEval[];
const scenario = (id: number) => evals.find((entry) => entry.id === id);
const expected = (id: number) => [scenario(id)?.expected_output, ...(scenario(id)?.expectations ?? [])].join(" ");

describe("run-goal ownership and proof (#778)", () => {
  it("probes actual ownership and a valid submission route before promising changes", () => {
    const intake = skill.split("## Phase 1")[1]?.split("## Phase 2")[0] ?? "";
    expect(intake).toMatch(/actual owner[\s\S]*writable[\s\S]*valid submission route/i);
    expect(intake).toMatch(/unknown[\s\S]*ownership[\s\S]*route[\s\S]*unverified/i);
  });

  it("preserves externally owned criteria unless the user explicitly approves a revised goal", () => {
    const contract = skill.split("## Phase 2")[1]?.split("## Phase 3")[0] ?? "";
    expect(contract).not.toMatch(/scope a "resolve" goal to what\s+this session controls/);
    expect(contract).toMatch(/original acceptance criteria[\s\S]*blocked or unverified/i);
    expect(contract).toMatch(/explicit user approval[\s\S]*replace[\s\S]*criteria/i);
    expect(contract).toMatch(/owner.ask draft[\s\S]*not[\s\S]*original goal[\s\S]*complete/i);
    expect(expected(67)).toMatch(/original[\s\S]*blocked or unverified[\s\S]*explicit user approval/i);
    expect(expected(67)).not.toContain("Names the other team's action as out of scope");
  });

  it("reads proof images and reconciles the same run's authoritative log before completion", () => {
    const verify = skill.split("## Phase 5")[1]?.split("## Phase 6")[0] ?? "";
    expect(verify).toMatch(/every proof image[\s\S]*image itself[\s\S]*system-of-record log/i);
    expect(verify).toMatch(/same run[\s\S]*caption[\s\S]*not[\s\S]*completion/i);
    expect(verify).toMatch(/unavailable[\s\S]*unverified/i);
  });

  it("supplies owner and route lookup evidence without authorizing a message or a substitute outcome", () => {
    const fixture = scenario(236);
    expect(fixture).toBeDefined();
    const raw = /Ownership lookup fixture:\n```json\n([\s\S]+?)\n```/.exec(fixture?.prompt ?? "");
    expect(raw).not.toBeNull();
    const lookup = JSON.parse(raw?.[1] ?? "{}") as {
      targets: Array<{ criterion: string; owner: string; writable: boolean; route: string; routeVerified: boolean }>;
    };
    expect(lookup.targets.filter(({ writable }) => !writable).map(({ criterion }) => criterion)).toEqual([
      "React 18 runtime",
      "shared plugin list",
    ]);
    expect(lookup.targets.every(({ owner, route, routeVerified }) => owner && route && routeVerified)).toBe(true);
    expect(expected(236)).toMatch(/probe[\s\S]*owner[\s\S]*submission route[\s\S]*before/i);
    expect(expected(236)).toMatch(/original[\s\S]*blocked or unverified[\s\S]*explicit user approval/i);
    expect(expected(236)).toMatch(/draft[\s\S]*does not post[\s\S]*does not[\s\S]*complete/i);
    expect(expected(236)).toMatch(/unknown[\s\S]*unverified/i);
  });

  it("supplies a readable waiting image and same-run log despite a misleading completion caption", () => {
    const fixture = scenario(237);
    expect(fixture).toBeDefined();
    const raw = /System-of-record log:\n```json\n([\s\S]+?)\n```/.exec(fixture?.prompt ?? "");
    expect(raw).not.toBeNull();
    const log = JSON.parse(raw?.[1] ?? "{}") as {
      runId: string;
      state: string;
      inputPending: boolean;
      completed: boolean;
    };
    expect(log).toEqual({ runId: "run-proof-1", state: "waiting-input", inputPending: true, completed: false });
    const image = readFileSync(join(root, "evals", "fixtures", "waiting-proof.svg"), "utf8");
    expect(image).toContain("run-proof-1");
    expect(image).toContain("Waiting for your answer");
    expect(image).toContain("Input pending");
    expect(fixture?.prompt).toMatch(/human-complete[\s\S]*waiting-proof\.svg/);
    expect(expected(237)).toMatch(/read[\s\S]*image itself[\s\S]*system-of-record log[\s\S]*same run/i);
    expect(expected(237)).toMatch(/not complete[\s\S]*unavailable[\s\S]*unverified/i);
  });

  it("retains independent grading and cited approval requirements", () => {
    expect(skill).toContain("a fresh-context subagent to grade each");
    expect(skill).toMatch(/An approval\s+you cannot cite/);
  });
});

const execution = readFileSync(join(root, "references/execution.md"), "utf8");
const intake = skill.split("## Phase 1")[1]?.split("## Phase 2")[0] ?? "";
const discovery = execution.split("## Skill discovery and command identity\n")[1]?.split("\n## ")[0] ?? "";
const prefixHash = (entries: SkillEval[]) =>
  createHash("sha256")
    .update(JSON.stringify(entries.slice(0, 246)))
    .digest("hex");
const originalPrefixHash = "fff8084b1d0a3e77f1339b9d837b1c86497a69f2913d911d07242b082d9816da";
const structured = (id: number, label: string, field: "prompt" | "expected_output") => {
  const entry = scenario(id);
  expect(entry, `missing registered discovery case ${id}`).toBeDefined();
  const match = new RegExp(`${label}:\\n\`\`\`json\\n([\\s\\S]+?)\\n\`\`\``).exec(entry?.[field] ?? "");
  expect(match, `missing structured ${field} for ${id}`).not.toBeNull();
  return JSON.parse(match?.[1] ?? "{}");
};

const plan = readFileSync(join(root, "../../../docs/plans/run-goal-skill-discovery-and-routing.md"), "utf8");
const appendix = /```json\n([\s\S]+)\n```/.exec(plan.split("## Frozen eval appendix")[1] ?? "");
const registeredEvals = JSON.parse(appendix?.[1] ?? "[]") as SkillEval[];
const descriptors = JSON.parse(
  /```json\n([\s\S]+?)\n```/.exec(plan.split("### Exact aggregate-control descriptors")[1] ?? "")?.[1] ?? "{}",
) as {
  expectationsAddition: SkillEval;
  assertionsAddition: SkillEval;
  controls: Array<{
    id: string;
    accepted: boolean;
    originalMutationSuffix?: string;
    registeredMutationSuffix?: string;
  }>;
};

function aggregateContract(skillDir: string) {
  const entries = JSON.parse(readFileSync(join(skillDir, "evals/evals.json"), "utf8")).evals as SkillEval[];
  const registered = entries.slice(246, 250);
  const schemaErrors = validateEvals(skillDir).filter(({ severity }) => severity === "error");
  const guards = {
    historicalPrefix: prefixHash(entries) === originalPrefixHash,
    registeredObjects: isDeepStrictEqual(registered, registeredEvals),
    registeredIds: isDeepStrictEqual(
      registered.map(({ id }) => id),
      [247, 248, 249, 250],
    ),
    registeredMinimum: registered.every(({ expectations }) => expectations && expectations.length >= 3),
    uniqueIds: new Set(entries.map(({ id }) => id)).size === entries.length,
    schemaValid: schemaErrors.length === 0,
  };
  return { accepted: Object.values(guards).every(Boolean), guards, schemaErrors };
}

function aggregateControlInput(control: (typeof descriptors.controls)[number]): SkillEval[] {
  const entries = structuredClone(evals.slice(0, 250));
  expect(prefixHash(entries)).toBe(originalPrefixHash);
  expect(entries.slice(246)).toEqual(registeredEvals);
  switch (control.id) {
    case "future-expectations":
      entries.push(structuredClone(descriptors.expectationsAddition));
      break;
    case "future-assertions":
      entries.push(structuredClone(descriptors.assertionsAddition));
      break;
    case "duplicate-future":
      entries.push(
        structuredClone(descriptors.expectationsAddition),
        structuredClone(descriptors.expectationsAddition),
      );
      break;
    case "empty-future":
      entries.push({ ...structuredClone(descriptors.expectationsAddition), expectations: [] });
      break;
    case "original-mutation":
      entries.find(({ id }) => id === 245)!.expected_output += control.originalMutationSuffix;
      break;
    case "registered-mutation":
      entries.find(({ id }) => id === 250)!.expected_output += control.registeredMutationSuffix;
      break;
    case "current":
      break;
    default:
      throw new Error("Unknown registered aggregate control");
  }
  return entries;
}

describe("run-goal skill discovery and routing (#793, #795)", () => {
  it("validates the actual current file through the shared aggregate contract", () => {
    expect(appendix).not.toBeNull();
    expect(aggregateContract(root)).toEqual({
      accepted: true,
      guards: {
        historicalPrefix: true,
        registeredObjects: true,
        registeredIds: true,
        registeredMinimum: true,
        uniqueIds: true,
        schemaValid: true,
      },
      schemaErrors: [],
    });
  });

  it.each(descriptors.controls)("classifies the registered aggregate control: $id", (control) => {
    const skillDir = mkdtempSync(join(tmpdir(), "run-goal-aggregate-"));
    try {
      mkdirSync(join(skillDir, "evals"));
      writeFileSync(join(skillDir, "evals/evals.json"), JSON.stringify({ evals: aggregateControlInput(control) }));
      const actual = aggregateContract(skillDir);
      console.log(`AGGREGATE_CONTROL=${JSON.stringify({ id: control.id, ...actual })}`);
      expect(actual.accepted).toBe(control.accepted);
      if (control.id === "duplicate-future") {
        expect(actual.guards.uniqueIds).toBe(false);
        expect(actual.schemaErrors.some(({ message }) => message.includes("duplicate id 251"))).toBe(true);
      } else if (control.id === "empty-future") {
        expect(actual.guards.schemaValid).toBe(false);
        expect(
          actual.schemaErrors.some(
            ({ message }) => message.includes("needs ≥3 non-empty") && message.includes("found 0"),
          ),
        ).toBe(true);
      } else if (control.id === "original-mutation") {
        expect(actual.guards.historicalPrefix).toBe(false);
        expect(actual.guards.registeredObjects).toBe(true);
        expect(actual.schemaErrors).toEqual([]);
      } else if (control.id === "registered-mutation") {
        expect(actual.guards.historicalPrefix).toBe(true);
        expect(actual.guards.registeredObjects).toBe(false);
        expect(actual.schemaErrors).toEqual([]);
      }
    } finally {
      rmSync(skillDir, { recursive: true, force: true });
    }
  });

  it("keeps grader answer keys out of every actor input", () => {
    for (const id of [247, 248, 249, 250]) {
      expect(scenario(id)?.prompt).not.toMatch(
        /"(?:criterionRetained|discoveryReadsAfterInstall|loadedIdentity|invocations|inventedOperations|skillInvocationVerdict|collisionRiskRecorded|observedWinner|requestedCommandInvocationVerdict|goalComplete|selectedArgv|slashInvocations|collisionBlockers)"\s*:/,
      );
      expect(scenario(id)?.prompt).toContain("Simulated decision trace only");
    }
  });

  it("makes post-install discovery decisive without supplying prior invocation completion", () => {
    expect(structured(247, "Skill rediscovery fixture", "prompt")).toMatchObject({
      initialDiscovery: [],
      events: [
        { event: "install-completed", status: "success" },
        {
          event: "supported-discovery-readback",
          skills: [
            {
              identity: "review-fixture-r1",
              sourcePath: "/fixture/plugin/skills/review-fixture/SKILL.md",
              availableInCurrentSession: true,
              invocable: true,
            },
          ],
        },
      ],
      invocationHistory: [],
      scriptedInvocationResponse: {
        condition:
          "Produced only after the next authorized invocation of review-fixture-r1 for alpha; not prior completion evidence",
        response: { identity: "review-fixture-r1", task: "alpha", result: "fixture-review-ok" },
      },
    });
    expect(structured(247, "Skill rediscovery oracle", "expected_output")).toEqual({
      criterionRetained: true,
      discoveryReadsAfterInstall: 1,
      loadedIdentity: "review-fixture-r1",
      invocations: [{ identity: "review-fixture-r1", task: "alpha" }],
      evidence: "fixture-review-ok",
      inventedOperations: 0,
      repeatDiscoveryDuplicateInvocations: 0,
    });
  });

  it("distinguishes disk installation from unavailable discovery and invocation", () => {
    expect(structured(248, "Unavailable skill discovery fixture", "prompt")).toMatchObject({
      exposedCapabilities: ["read files"],
      currentSessionDiscovery: null,
      nativeRefreshOperation: null,
      nativeInvocationOperation: null,
    });
    expect(structured(248, "Unavailable skill discovery oracle", "expected_output")).toEqual({
      criterionRetained: true,
      skillInvocationVerdict: "unverified",
      diskIsInvocationProof: false,
      invocations: [],
      inventedOperations: 0,
      newSessions: 0,
      nativeStoreEdits: 0,
      independentWorkMayContinue: true,
    });
  });

  it("makes the observed skill winner disagree with the ready requested command", () => {
    expect(structured(249, "Slash routing fixture", "prompt")).toMatchObject({
      requestedSource: { identity: "repo-command-work-r1", sourcePath: "/fixture/repo/commands/work.md" },
      supportedCommandReadiness: {
        version: 1,
        commands: [
          {
            filename: "work.md",
            sourcePath: "/fixture/repo/commands/work.md",
            targets: [{ agent: "claude-code", ready: true, status: "ready" }],
          },
        ],
      },
      currentSessionSkills: [{ name: "work", identity: "personal-skill-work-r1", invocable: true }],
      invocationObservation: {
        typed: "/work",
        selectedIdentity: "personal-skill-work-r1",
        result: "fixture-personal-work",
      },
      supportedQualifiedRoutes: [],
      sourceCorrectionAuthorization: false,
    });
    expect(structured(249, "Slash routing oracle", "expected_output")).toEqual({
      collisionRiskRecorded: true,
      deployedCommandIdentity: "repo-command-work-r1",
      observedWinner: "personal-skill-work-r1",
      requestedCommandInvocationVerdict: "unverified",
      qualifiedRoute: null,
      ownerArtifactMutations: 0,
      goalComplete: false,
    });
  });

  it("keeps literal CLI argv separate from a same-name skill", () => {
    expect(structured(250, "Literal CLI routing fixture", "prompt")).toMatchObject({
      requestedArgv: ["tool", "work", "--check"],
      availableSkills: [{ name: "work", identity: "personal-skill-work-r1" }],
      commandReadback: { argv: ["tool", "work", "--check"], exit: 0, stdout: "fixture-cli-check-ok" },
      slashInvocationRequested: false,
    });
    expect(structured(250, "Literal CLI routing oracle", "expected_output")).toEqual({
      selectedArgv: ["tool", "work", "--check"],
      slashInvocations: 0,
      collisionBlockers: 0,
      ownerArtifactMutations: 0,
      requestedCliCheckVerdict: "met",
      evidence: "fixture-cli-check-ok",
    });
  });

  it("requires rediscovery, original conditional steps and exactly one evidenced invocation", () => {
    requireTerms(intake, [/after[\s\S]*install[\s\S]*refresh[\s\S]*discovery/i, /references\/execution\.md/]);
    requireTerms(discovery, [
      /identity[\s\S]*source/i,
      /original conditional[\s\S]*once[\s\S]*result/i,
      /repeated[\s\S]*not[\s\S]*repeat/i,
    ]);
  });

  it("requires exposed capabilities and keeps missing session evidence unverified", () => {
    requireTerms(discovery, [
      /only[\s\S]*exposed/i,
      /disk[\s\S]*not[\s\S]*current.session/i,
      /unavailable[\s\S]*unverified/i,
      /never invent[\s\S]*(?:refresh|list)[\s\S]*API/i,
    ]);
  });

  it("requires evidenced slash routing and preserves owner artifacts without a route", () => {
    requireTerms(intake, [/slash command[\s\S]*skills[\s\S]*commands/i, /Assumptions and Risks/]);
    requireTerms(discovery, [
      /winning source[\s\S]*target[\s\S]*invocation/i,
      /no supported route[\s\S]*unverified/i,
      /do not delete or rename/i,
      /Claude[\s\S]*Codex/,
    ]);
  });

  it("requires literal CLI preservation without basename-only blockers", () => {
    requireTerms(discovery, [
      /literal CLI[\s\S]*argv/i,
      /basename[\s\S]*not[\s\S]*block/i,
      /matching[\s\S]*does not[\s\S]*slash/i,
    ]);
  });
});
