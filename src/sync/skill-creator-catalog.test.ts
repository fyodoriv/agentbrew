import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const network = vi.hoisted(() => ({ cache: "" }));
vi.mock("../catalog/index-source.js", async (original) => ({
  ...(await original<typeof import("../catalog/index-source.js")>()),
  getSourceCachePath: vi.fn(() => network.cache),
}));

import { applyAgentfile } from "../agentfile-apply.js";
import { installSkills } from "../catalog/install.js";
import { installSkill } from "../catalog/install-skill.js";
import * as catalog from "../catalog/types.js";
import { checkUserCreatedSkills } from "../drift-checks/skills.js";
import { loadManifest } from "../manifest.js";
import { defaultState, loadState, saveState } from "../state.js";
import { AGENT_DEFINITIONS } from "../types.js";
import { cleanBrokenSymlinksGlobally, extractFrontmatterFeatures, findSkillCopies, syncSkills } from "./skills-sync.js";

const name = "skill-creator";
const source = "anthropics/skills";
const targets = [".agents", ".claude", ".codex"];
const planned = {
  name,
  source,
  description: "Synthetic fixture",
  category: "development",
  recommended: false,
  preserveExisting: true,
};
const upstream = "---\nname: skill-creator\ndescription: Synthetic portable fixture\n---\nUPSTREAM_FIXTURE\n";
const resources = new Map([
  ["scripts/run_eval.py", "SYNTHETIC_SCRIPT_FIXTURE\n"],
  ["agents/grader.md", "SYNTHETIC_GRADER_FIXTURE\n"],
  ["assets/eval_review.html", "SYNTHETIC_ASSET_FIXTURE\n"],
]);

function writeSkill(path: string, body: string): void {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "SKILL.md"), body);
}
function destination(host: string): string {
  return join(homedir(), host, "skills", name);
}
function seed(): void {
  for (const path of [".agents", ".claude", ".codex", ".config/agentbrew"]) {
    rmSync(join(homedir(), path), { recursive: true, force: true });
  }
  network.cache = join(homedir(), "public-source-fixture");
  writeSkill(join(network.cache, "skills", name), upstream);
  for (const [relative, body] of resources) {
    const path = join(network.cache, "skills", name, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  }
  writeSkill(join(network.cache, "skills", "unselected-fixture"), "UNSELECTED_FIXTURE\n");
  process.env.AGENTBREW_DIR = join(homedir(), "empty-agentbrew-fixture");
  mkdirSync(process.env.AGENTBREW_DIR, { recursive: true });
  saveState({
    ...defaultState(),
    agents: AGENT_DEFINITIONS.filter((agent) => ["claude-code", "codex"].includes(agent.name)).map((agent) => ({
      ...agent,
      detected: true,
    })),
    sources: [
      {
        url: source,
        type: "github",
        skillsInstalled: [],
        availableItems: [],
        addedAt: "2026-01-01",
        commitSha: "a".repeat(40),
      },
    ],
  });
}
async function installPlanned(): Promise<void> {
  await installSkill(planned, { alreadyInstalled: [], failedSourceSkips: new Map() });
}
beforeEach(() => {
  seed();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("optional skill creator catalog selection", () => {
  it("pins the optional public provider and resolves its Agentfile name without a warning", () => {
    const skill = catalog.loadCatalog().skills.find((entry) => entry.name === name);
    expect(skill).toMatchObject({ source, recommended: false, preserveExisting: true });
    const owner = join(homedir(), "project");
    mkdirSync(owner, { recursive: true });
    writeFileSync(join(owner, "Agentfile.yaml"), "skills: [skill-creator]\n");
    expect(applyAgentfile(owner)?.skillsToInstall).toEqual([name]);
    expect(vi.mocked(console.warn).mock.calls.flat().join("\n")).not.toContain("Unknown skill");
  });

  it("runs the scratch Agentfile through the installer and both hosts while keeping the native builtin", async () => {
    const native = join(homedir(), ".codex/skills/.system", name);
    writeSkill(native, "NATIVE_CREATOR_FIXTURE\n");
    const owner = join(homedir(), "project");
    mkdirSync(owner, { recursive: true });
    writeFileSync(join(owner, "Agentfile.yaml"), "skills: [skill-creator]\nsources: [anthropics/skills]\n");
    const applied = applyAgentfile(owner);
    expect(applied?.skillsToInstall).toEqual([name]);
    await installSkills(applied!.skillsToInstall);
    const result = await syncSkills({ quiet: true });
    expect(result.replacedCopies).toEqual([]);
    for (const host of targets) {
      expect(lstatSync(destination(host)).isSymbolicLink()).toBe(true);
      expect(readFileSync(join(destination(host), "SKILL.md"), "utf-8")).toBe(upstream);
      for (const [relative, body] of resources) {
        expect(readFileSync(join(destination(host), relative), "utf-8")).toBe(body);
        expect(readFileSync(join(homedir(), ".config/agentbrew/installed-skills", name, relative), "utf-8")).toBe(body);
      }
      expect(existsSync(join(homedir(), host, "skills", "unselected-fixture"))).toBe(false);
    }
    expect(readFileSync(join(native, "SKILL.md"), "utf-8")).toBe("NATIVE_CREATOR_FIXTURE\n");
    expect(loadState()!.sources?.find((entry) => entry.url === source)?.skillsInstalled).toEqual([name]);
    expect(extractFrontmatterFeatures({ name, description: "Synthetic portable fixture" })).toEqual([]);
  });

  it("keeps pre-existing owner directories in place with no backup replacement or adoption", async () => {
    for (const host of targets) writeSkill(destination(host), `OWNER_${host}\n`);
    const identities = targets.map((host) => lstatSync(destination(host)).ino);
    await installPlanned();
    expect(findSkillCopies()).toEqual([]);
    for (let pass = 0; pass < 2; pass++) {
      expect((await syncSkills({ quiet: true })).replacedCopies).toEqual([]);
      for (const [index, host] of targets.entries()) {
        expect(lstatSync(destination(host)).isDirectory()).toBe(true);
        expect(lstatSync(destination(host)).ino).toBe(identities[index]);
        expect(readFileSync(join(destination(host), "SKILL.md"), "utf-8")).toBe(`OWNER_${host}\n`);
        expect(loadManifest().localSkillLinks?.[destination(host)]).toBeUndefined();
        expect(loadManifest().localSkillConflicts).toContain(destination(host));
      }
    }
    expect(existsSync(join(homedir(), ".config/agentbrew/backups/skill-copies"))).toBe(false);
    expect(checkUserCreatedSkills({ dedupe: false }).filter((entry) => entry.detail.endsWith(name))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agent: "claude-code", type: "skills-user-added" }),
        expect.objectContaining({ agent: "codex", type: "skills-user-added" }),
      ]),
    );
  });

  it("keeps foreign owner links and their target bodies unchanged", async () => {
    const foreign = join(homedir(), "foreign-owner-fixture");
    writeSkill(foreign, "FOREIGN_OWNER_FIXTURE\n");
    for (const host of targets) {
      mkdirSync(join(homedir(), host, "skills"), { recursive: true });
      symlinkSync(foreign, destination(host));
    }
    await installPlanned();
    expect((await syncSkills({ quiet: true })).replacedCopies).toEqual([]);
    for (const host of targets) {
      expect(readlinkSync(destination(host))).toBe(foreign);
      expect(loadManifest().localSkillConflicts).toContain(destination(host));
    }
    expect(readFileSync(join(foreign, "SKILL.md"), "utf-8")).toBe("FOREIGN_OWNER_FIXTURE\n");
  });

  it("reconciles exact receipts and owner tombstones while preserving opt-out copy migration", async () => {
    await installPlanned();
    await syncSkills({ quiet: true });
    expect(loadManifest().localSkillLinks?.[destination(".codex")]).toBeDefined();
    const foreign = join(homedir(), "owner-missing-fixture");
    unlinkSync(destination(".codex"));
    symlinkSync(foreign, destination(".codex"));
    await syncSkills({ quiet: true });
    cleanBrokenSymlinksGlobally();
    expect(readlinkSync(destination(".codex"))).toBe(foreign);
    expect(loadManifest().localSkillConflicts).toContain(destination(".codex"));
    saveState({ ...loadState()!, sources: [], skillSourceDirs: [] });
    await syncSkills({ quiet: true });
    expect(existsSync(destination(".claude"))).toBe(false);
    expect(readlinkSync(destination(".codex"))).toBe(foreign);
    unlinkSync(destination(".codex"));
    await syncSkills({ quiet: true });
    expect(loadManifest().localSkillConflicts).not.toContain(destination(".codex"));

    seed();
    const current = catalog.loadCatalog();
    vi.spyOn(catalog, "loadCatalog").mockReturnValue({
      ...current,
      skills: current.skills.map((entry) => ({ ...entry, preserveExisting: false })),
    });
    writeSkill(destination(".claude"), "LEGACY_COPY_FIXTURE\n");
    await installPlanned();
    const result = await syncSkills({ quiet: true });
    expect(result.replacedCopies.some((copy) => copy.path === destination(".claude"))).toBe(true);
    expect(lstatSync(destination(".claude")).isSymbolicLink()).toBe(true);
  });

  it("does not activate owner preservation from a matching basename without exact provider and source path", async () => {
    for (const axis of ["source-path", "provider"]) {
      seed();
      await installPlanned();
      const state = loadState()!;
      if (axis === "source-path") {
        const root = join(homedir(), "other-source-fixture");
        writeSkill(join(root, name), "OTHER_SOURCE_FIXTURE\n");
        saveState({ ...state, skillSourceDirs: [{ label: "other", path: root }, ...(state.skillSourceDirs ?? [])] });
      } else {
        saveState({ ...state, sources: state.sources!.map((entry) => ({ ...entry, url: "example/other-skills" })) });
      }
      writeSkill(destination(".claude"), "DEFAULT_COPY_FIXTURE\n");
      expect(findSkillCopies().some((copy) => copy.path === destination(".claude"))).toBe(true);
      expect(
        (await syncSkills({ quiet: true })).replacedCopies.some((copy) => copy.path === destination(".claude")),
      ).toBe(true);
      expect(lstatSync(destination(".claude")).isSymbolicLink()).toBe(true);
    }
  });
});
