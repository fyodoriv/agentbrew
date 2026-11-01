import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { generateAgentfile, mergeAgentfiles, parseAgentfile } from "../agentfile.js";
import { applyAgentfile } from "../agentfile-apply.js";
import { loadManifest } from "../manifest.js";
import { loadState, saveState } from "../state.js";
import { cleanBrokenSymlinksGlobally, syncSkills } from "./skills-sync.js";

const hosts = [".claude", ".codex"];
function skill(root: string, name: string): string {
  const path = join(root, name);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "SKILL.md"), `---\nname: ${name}\ndescription: Safe fixture\n---\nFixture.\n`);
  return path;
}
function declare(owner: string, dirs: string[], dryRun = false): void {
  mkdirSync(owner, { recursive: true });
  writeFileSync(join(owner, "Agentfile.yaml"), `skillDirectories: ${JSON.stringify(dirs)}\n`);
  applyAgentfile(owner, { quiet: true, authoritative: false, pruneOwnedDirs: true, dryRun });
}
function linked(host: string, name: string): string {
  return join(homedir(), host, "skills", name);
}
function fixture() {
  const owner = mkdtempSync(join(homedir(), "skill-owner-"));
  const root = join(owner, "skills");
  const first = skill(root, "first-local-fixture");
  return { owner, root, first };
}
beforeEach(() => {
  for (const host of [...hosts, ".agents"]) rmSync(join(homedir(), host, "skills"), { recursive: true, force: true });
  rmSync(join(homedir(), ".config/agentbrew/manifest.json"), { force: true });
  process.env.AGENTBREW_DIR = mkdtempSync(join(homedir(), "empty-agentbrew-"));
  saveState({
    catalogVersion: "fixture",
    agents: hosts.map((host) => ({
      name: host === ".claude" ? "claude-code" : "codex",
      detected: true,
      skillsDir: `~/${host}/skills`,
    })),
  });
});

describe("Agentfile skillDirectories", () => {
  it("retains excluded-host receipts when the owned source disappears without an owner edit", async () => {
    const f = fixture();
    declare(f.owner, [f.root]);
    await syncSkills({ quiet: true });
    saveState({
      ...loadState()!,
      agents: loadState()!.agents.map((agent) => ({ ...agent, detected: agent.name !== "codex" })),
    });
    rmSync(f.root, { recursive: true });
    const junk = linked(".codex", "excluded-unmanaged-broken");
    symlinkSync(join(f.owner, "unrelated-missing"), junk);
    await syncSkills({ quiet: true });
    const codex = linked(".codex", "first-local-fixture");
    expect(lstatSync(linked(".claude", "first-local-fixture"), { throwIfNoEntry: false })).toBeUndefined();
    expect(lstatSync(junk, { throwIfNoEntry: false })).toBeUndefined();
    expect(lstatSync(codex, { throwIfNoEntry: false })?.isSymbolicLink()).toBe(true);
    cleanBrokenSymlinksGlobally();
    expect(readlinkSync(codex)).toBe(f.first);
    expect(loadManifest().localSkillLinks?.[codex]).toBe(f.first);
  });
  it("preserves a broken owner retarget on an excluded host during sync's explicit sweep", async () => {
    const f = fixture();
    declare(f.owner, [f.root]);
    await syncSkills({ quiet: true });
    const dest = linked(".codex", "first-local-fixture");
    const ownerTarget = join(f.owner, "excluded-owner-missing");
    unlinkSync(dest);
    symlinkSync(ownerTarget, dest);
    saveState({
      ...loadState()!,
      agents: loadState()!.agents.map((agent) => ({ ...agent, detected: agent.name !== "codex" })),
    });
    const junk = linked(".codex", "excluded-unrelated-broken");
    symlinkSync(join(f.owner, "unrelated-missing"), junk);
    await syncSkills({ quiet: true });
    expect(lstatSync(junk, { throwIfNoEntry: false })).toBeUndefined();
    expect(lstatSync(dest, { throwIfNoEntry: false })?.isSymbolicLink()).toBe(true);
    expect(readlinkSync(dest)).toBe(ownerTarget);
  });
  it("preserves broken owner retargets in the standalone repair sweep but cleans unrelated broken links", async () => {
    const f = fixture();
    declare(f.owner, [f.root]);
    await syncSkills({ quiet: true });
    const dest = linked(".codex", "first-local-fixture");
    const ownerTarget = join(f.owner, "owner-missing-target");
    unlinkSync(dest);
    symlinkSync(ownerTarget, dest);
    await syncSkills({ quiet: true });
    expect(loadManifest().localSkillConflicts).toContain(dest);
    expect(readlinkSync(dest)).toBe(ownerTarget);
    const junk = linked(".codex", "unrelated-broken-fixture");
    symlinkSync(join(f.owner, "unrelated-missing"), junk);
    cleanBrokenSymlinksGlobally();
    expect(lstatSync(junk, { throwIfNoEntry: false })).toBeUndefined();
    expect(lstatSync(dest, { throwIfNoEntry: false })?.isSymbolicLink()).toBe(true);
    expect(readlinkSync(dest)).toBe(ownerTarget);
  });
  it("uses the skill scanner despite a legacy task-source entry at the same path", async () => {
    const f = fixture();
    saveState({ ...loadState()!, skillSourceDirs: [{ label: "manual", path: f.root, format: "tasks-md" }] });
    declare(f.owner, [f.root]);
    await syncSkills({ quiet: true });
    for (const host of hosts) {
      expect(existsSync(linked(host, "first-local-fixture"))).toBe(true);
      expect(readlinkSync(linked(host, "first-local-fixture"))).toBe(f.first);
    }
    expect(loadState()?.skillSourceDirs?.find((dir) => dir.label === "manual")?.format).toBe("tasks-md");
  });
  it("does not prune a valid deployed link from an excluded host", async () => {
    const f = fixture();
    declare(f.owner, [f.root]);
    await syncSkills({ quiet: true });
    saveState({
      ...loadState()!,
      agents: loadState()!.agents.map((agent) => ({ ...agent, detected: agent.name !== "codex" })),
    });
    declare(f.owner, []);
    await syncSkills({ quiet: true });
    expect(readlinkSync(linked(".codex", "first-local-fixture"))).toBe(f.first);
    expect(existsSync(linked(".claude", "first-local-fixture"))).toBe(false);
  });
  it("uses a caller-owned manifest and leaves it unchanged during dry run", async () => {
    const f = fixture();
    declare(f.owner, [f.root]);
    const manifest = { hashes: {} };
    await syncSkills({ quiet: true, dryRun: true }, { manifest });
    expect(manifest).toEqual({ hashes: {} });
    expect(existsSync(linked(".claude", "first-local-fixture"))).toBe(false);
    await syncSkills({ quiet: true }, { manifest });
    expect(manifest).toMatchObject({
      localSkillLinks: {
        [linked(".claude", "first-local-fixture")]: f.first,
        [linked(".codex", "first-local-fixture")]: f.first,
      },
    });
    expect(existsSync(join(homedir(), ".config/agentbrew/manifest.json"))).toBe(false);
  });
  it("defers link removal with no-prune and prunes on the next ordinary sync", async () => {
    const f = fixture();
    declare(f.owner, [f.root]);
    await syncSkills({ quiet: true });
    declare(f.owner, []);
    await syncSkills({ quiet: true, prune: false });
    for (const host of hosts) expect(readlinkSync(linked(host, "first-local-fixture"))).toBe(f.first);
    await syncSkills({ quiet: true });
    for (const host of hosts) expect(existsSync(linked(host, "first-local-fixture"))).toBe(false);
  });
  it("clears owner conflict protection only after observing the destination absent", async () => {
    const f = fixture();
    declare(f.owner, [f.root]);
    await syncSkills({ quiet: true });
    const dest = linked(".codex", "first-local-fixture");
    unlinkSync(dest);
    mkdirSync(dest);
    writeFileSync(join(dest, "SKILL.md"), "Owner fixture.\n");
    await syncSkills({ quiet: true });
    expect(loadManifest().localSkillConflicts).toContain(dest);
    rmSync(dest, { recursive: true });
    await syncSkills({ quiet: true });
    expect(readlinkSync(dest)).toBe(f.first);
    expect(loadManifest().localSkillConflicts).not.toContain(dest);
    expect(loadManifest().localSkillLinks?.[dest]).toBe(f.first);
  });
  it("retains folder declarations when generating an Agentfile from state", () => {
    const f = fixture();
    declare(f.owner, [f.root]);
    expect(parseAgentfile(generateAgentfile()!)).toMatchObject({ skillDirectories: [f.root] });
  });
  it("keeps initially unowned destinations after restoring a manual selection", async () => {
    const f = fixture();
    const other = skill(f.root, "other-local-fixture");
    saveState({
      ...loadState()!,
      sources: [
        {
          url: f.root,
          type: "local",
          skillsInstalled: ["first-local-fixture"],
          availableItems: [],
          addedAt: "fixture",
        },
      ],
    });
    for (const host of hosts) mkdirSync(join(homedir(), host, "skills"), { recursive: true });
    const claude = linked(".claude", "first-local-fixture");
    const codex = linked(".codex", "first-local-fixture");
    symlinkSync(other, claude);
    mkdirSync(codex);
    writeFileSync(join(codex, "SKILL.md"), "Original owner notes.\n");
    declare(f.owner, [f.root]);
    await syncSkills({ quiet: true });
    declare(f.owner, []);
    await syncSkills({ quiet: true });
    await syncSkills({ quiet: true });
    expect(readlinkSync(claude)).toBe(other);
    expect(readFileSync(join(codex, "SKILL.md"), "utf-8")).toBe("Original owner notes.\n");
  });
  it("parses and rebases merged declarations", () => {
    const f = fixture();
    declare(f.owner, ["./skills"]);
    expect(parseAgentfile(mergeAgentfiles([join(f.owner, "Agentfile.yaml")]))).toMatchObject({
      skillDirectories: [f.root],
    });
  });
  it("deploys all folder skills and future additions despite an empty manual selection", async () => {
    const f = fixture();
    const source = { url: f.root, type: "local" as const, skillsInstalled: [], availableItems: [], addedAt: "fixture" };
    saveState({ ...loadState()!, sources: [source] });
    declare(f.owner, ["./skills"]);
    await syncSkills({ quiet: true });
    for (const host of hosts) expect(readlinkSync(linked(host, "first-local-fixture"))).toBe(f.first);
    const next = skill(f.root, "future-local-fixture");
    await syncSkills({ quiet: true });
    for (const host of hosts) expect(readlinkSync(linked(host, "future-local-fixture"))).toBe(next);
    expect(loadState()?.sources?.[0].skillsInstalled).toEqual([]);
  });
  it("prunes declaration links while source files remain and keeps dry runs read-only", async () => {
    const f = fixture();
    declare(f.owner, [f.root]);
    await syncSkills({ quiet: true });
    const before = readFileSync(join(homedir(), ".config/agentbrew/state.yaml"), "utf-8");
    declare(f.owner, [], true);
    await syncSkills({ quiet: true, dryRun: true });
    expect(readFileSync(join(homedir(), ".config/agentbrew/state.yaml"), "utf-8")).toBe(before);
    for (const host of hosts) expect(lstatSync(linked(host, "first-local-fixture")).isSymbolicLink()).toBe(true);
    declare(f.owner, []);
    await syncSkills({ quiet: true });
    expect(existsSync(f.first)).toBe(true);
    for (const host of hosts) expect(existsSync(linked(host, "first-local-fixture"))).toBe(false);
  });
  it("preserves another owner and restores manual selection after the last declaration", async () => {
    const f = fixture();
    const second = skill(f.root, "second-local-fixture");
    saveState({
      ...loadState()!,
      sources: [
        {
          url: f.root,
          type: "local",
          skillsInstalled: ["first-local-fixture"],
          availableItems: [],
          addedAt: "fixture",
        },
      ],
    });
    const other = mkdtempSync(join(homedir(), "another-skill-owner-"));
    declare(f.owner, [f.root]);
    declare(other, [f.root]);
    await syncSkills({ quiet: true });
    declare(f.owner, []);
    await syncSkills({ quiet: true });
    for (const host of hosts) expect(readlinkSync(linked(host, "second-local-fixture"))).toBe(second);
    expect(loadState()?.skillSourceDirs?.filter((d) => d.path === f.root)).toHaveLength(1);
    declare(other, []);
    await syncSkills({ quiet: true });
    for (const host of hosts) {
      expect(readlinkSync(linked(host, "first-local-fixture"))).toBe(f.first);
      expect(existsSync(linked(host, "second-local-fixture"))).toBe(false);
    }
    expect(loadState()?.sources?.[0].skillsInstalled).toEqual(["first-local-fixture"]);
  });
  it("preserves retargeted links and owner folders through repeated sync and removal", async () => {
    const f = fixture();
    const other = skill(f.root, "other-local-fixture");
    declare(f.owner, [f.root]);
    await syncSkills({ quiet: true });
    const claude = linked(".claude", "first-local-fixture");
    const codex = linked(".codex", "first-local-fixture");
    unlinkSync(claude);
    symlinkSync(other, claude);
    unlinkSync(codex);
    mkdirSync(codex);
    writeFileSync(join(codex, "SKILL.md"), "Owner notes.\n");
    await syncSkills({ quiet: true });
    declare(f.owner, []);
    await syncSkills({ quiet: true });
    await syncSkills({ quiet: true });
    expect(readlinkSync(claude)).toBe(other);
    expect(readFileSync(join(codex, "SKILL.md"), "utf-8")).toBe("Owner notes.\n");
    expect(loadManifest().hashes).toEqual({});
  });
  it("retains absent declarations and resumes after source recreation", async () => {
    const f = fixture();
    declare(f.owner, [f.root]);
    await syncSkills({ quiet: true });
    rmSync(f.root, { recursive: true });
    await syncSkills({ quiet: true });
    expect(loadState()?.skillSourceDirs?.some((d) => d.path === f.root)).toBe(true);
    for (const host of hosts) expect(existsSync(linked(host, "first-local-fixture"))).toBe(false);
    skill(f.root, "first-local-fixture");
    await syncSkills({ quiet: true });
    for (const host of hosts) expect(readlinkSync(linked(host, "first-local-fixture"))).toBe(f.first);
  });
});
