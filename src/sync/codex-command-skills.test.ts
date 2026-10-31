import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { unmanagedAgentSkills } from "../core/agent-runtime.js";
import { checkUserCreatedSkills } from "../drift-checks/skills.js";
import * as manifestModule from "../manifest.js";
import { contentHash, type Manifest } from "../manifest.js";
import { saveState } from "../state.js";
import {
  codexCommandSkillDrift,
  codexCommandSkillFiles,
  codexCommandSkillName,
  syncCodexCommandSkills,
} from "./codex-command-skills.js";
import { syncCommands } from "./command-sync.js";

vi.mock("./builtin-commands.js", () => ({ builtinCommandsDir: () => undefined, builtinCommandNames: () => [] }));
vi.mock("./commands-delegate.js", () => ({ delegateCommandsGenerate: () => new Map() }));

describe("native Codex command skills", () => {
  it("makes a winning source command available as an explicit native skill", async () => {
    const source = join(homedir(), "command-source");
    mkdirSync(source, { recursive: true });
    mkdirSync(join(homedir(), ".codex"), { recursive: true });
    const original =
      "---\ndescription: Harmless echo fixture\nallowed-tools: Bash\n---\nReport $ARGUMENTS and $1 without running tools.\n";
    writeFileSync(join(source, "witness.md"), original);
    saveState({
      agents: [{ name: "codex", detected: true, skillsDir: "~/.codex/skills" }],
      catalogVersion: "test",
      commandSourceDirs: [{ label: "fixture", path: source }],
    });
    await syncCommands({ quiet: true });
    const bridge = join(homedir(), ".codex/skills/agentbrew-command-witness");
    expect(existsSync(join(bridge, "SKILL.md"))).toBe(true);
    expect(readFileSync(join(bridge, "references/command.md"), "utf-8")).toBe(original);
  });
});

function nativeSource(name: string): string {
  const source = mkdtempSync(join(homedir(), "native-source-"));
  mkdirSync(join(homedir(), ".codex"), { recursive: true });
  writeFileSync(join(source, `${name}.md`), "Report safely without running tools.");
  saveState({
    agents: [{ name: "codex", detected: true, skillsDir: "~/.codex/skills" }],
    catalogVersion: "test",
    commandSourceDirs: [{ label: "fixture", path: source }],
  });
  return join(homedir(), ".codex/skills", codexCommandSkillName(`${name}.md`));
}

describe("native bridge integration", () => {
  it("does not label a hash-owned native bridge as a user-created skill", async () => {
    nativeSource("managed-native");
    await syncCommands({ quiet: true });
    expect(checkUserCreatedSkills().filter((item) => item.detail.includes("agentbrew-command-managed-native"))).toEqual(
      [],
    );
  });

  it("previews missing native leaves when legacy prompts are already current", async () => {
    const bridge = nativeSource("preview-native");
    await syncCommands({ quiet: true });
    unlinkSync(join(bridge, "SKILL.md"));
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnings = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await syncCommands({ dryRun: true });
      expect([...output.mock.calls, ...warnings.mock.calls].flat().join("\n")).toContain("Codex native command skills");
      expect(existsSync(join(bridge, "SKILL.md"))).toBe(false);
    } finally {
      output.mockRestore();
      warnings.mockRestore();
    }
  });

  it("uses the same winning source for legacy prompts and native references", async () => {
    const source = mkdtempSync(join(homedir(), "precedence-"));
    const first = join(source, "first");
    const last = join(source, "last");
    mkdirSync(first);
    mkdirSync(last);
    writeFileSync(join(first, "winner.md"), "first source");
    writeFileSync(join(last, "winner.md"), "winning source");
    saveState({
      agents: [{ name: "codex", detected: true, skillsDir: "~/.codex/skills" }],
      catalogVersion: "test",
      commandSourceDirs: [
        { label: "first", path: first },
        { label: "last", path: last },
      ],
    });
    await syncCommands({ quiet: true });
    expect(readFileSync(join(homedir(), ".codex/prompts/winner.md"), "utf-8")).toBe("winning source");
    expect(readFileSync(join(homedir(), ".codex/skills/agentbrew-command-winner/references/command.md"), "utf-8")).toBe(
      "winning source",
    );
  });
});

function fixture() {
  const skills = join(mkdtempSync(join(homedir(), "bridge-fixture-")), "skills");
  const manifest: Manifest = { hashes: {} };
  const warn = vi.fn();
  const options = { manifest, dryRun: false, prune: true, log: { warn } };
  const source = { filename: "echo.md", content: "---\nallowed-tools: Bash\n---\nReport $ARGUMENTS and $1.\n" };
  return { skills, manifest, warn, options, source, root: join(skills, codexCommandSkillName(source.filename)) };
}

describe("command skill ownership and arguments", () => {
  it("does not let a valid source name alias another source's encoded name", () => {
    const hash = contentHash("a_b.md").slice(0, 12);
    const names = ["a_b.md", `a-b-${hash}.md`, `x-a-b-${hash}.md`];
    expect(new Set(names.map(codexCommandSkillName)).size).toBe(names.length);
  });

  it("refuses a remaining name collision instead of overwriting either source", () => {
    const f = fixture();
    const hash = vi.spyOn(manifestModule, "contentHash").mockReturnValue("c".repeat(64));
    const sources = [
      { filename: "a_b.md", content: "first" },
      { filename: "a b.md", content: "second" },
    ];
    try {
      syncCodexCommandSkills(sources, f.skills, f.options);
      expect(Object.keys(f.manifest.hashes)).toEqual([]);
      expect(f.warn).toHaveBeenCalledWith(expect.stringContaining("name clash"));
    } finally {
      hash.mockRestore();
    }
  });

  it("keeps source bytes and uses explicit-only native policy without granting source permissions", () => {
    const { source } = fixture();
    const files = codexCommandSkillFiles(source);
    expect(files.get("references/command.md")).toBe(source.content);
    expect(files.get("SKILL.md")).toContain("Native skills do not expand command macros automatically");
    expect(files.get("SKILL.md")).toContain("quoted");
    expect(files.get("SKILL.md")).toContain("Named `$NAME` placeholders");
    expect(files.get("SKILL.md")).toContain("not permission grants");
    expect(files.get("SKILL.md")).not.toContain("allowed-tools:");
    expect(files.get("agents/openai.yaml")).toBe("policy:\n  allow_implicit_invocation: false\n");
  });

  it("maps unusual names deterministically without slug collisions or names above the native limit", () => {
    const names = ["a_b.md", "a-b.md", "A_B.md", "../../odd name!.md", "?!.md", `${"a".repeat(100)}.md`];
    const mapped = names.map(codexCommandSkillName);
    expect(new Set(mapped).size).toBe(names.length);
    for (const name of mapped) {
      expect(name).toMatch(/^agentbrew-command-[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(name.length).toBeLessThanOrEqual(64);
    }
    expect(names.map(codexCommandSkillName)).toEqual(mapped);
  });

  it("updates tracked leaves, is idempotent, and leaves private source-command folders untouched", () => {
    const f = fixture();
    const privateRoot = join(f.skills, "source-command-ship-it");
    mkdirSync(privateRoot, { recursive: true });
    writeFileSync(join(privateRoot, "SKILL.md"), "owner");
    syncCodexCommandSkills([f.source], f.skills, f.options);
    const originalHashes = { ...f.manifest.hashes };
    syncCodexCommandSkills([f.source], f.skills, f.options);
    expect(f.manifest.hashes).toEqual(originalHashes);
    syncCodexCommandSkills([{ ...f.source, content: "new source" }], f.skills, f.options);
    expect(readFileSync(join(f.root, "references/command.md"), "utf-8")).toBe("new source");
    expect(readFileSync(join(privateRoot, "SKILL.md"), "utf-8")).toBe("owner");
    expect(unmanagedAgentSkills(f.skills, f.manifest)).toEqual(["source-command-ship-it"]);
  });

  it("keeps an untracked collision and a folder with an edited managed leaf intact", () => {
    const f = fixture();
    mkdirSync(f.root, { recursive: true });
    writeFileSync(join(f.root, "SKILL.md"), "owner");
    syncCodexCommandSkills([f.source], f.skills, f.options);
    expect(existsSync(join(f.root, "references/command.md"))).toBe(false);
    expect(readFileSync(join(f.root, "SKILL.md"), "utf-8")).toBe("owner");
    expect(Object.keys(f.manifest.hashes)).toEqual([]);
    const g = fixture();
    syncCodexCommandSkills([g.source], g.skills, g.options);
    writeFileSync(join(g.root, "references/command.md"), "owner edited");
    syncCodexCommandSkills([{ ...g.source, content: "new source" }], g.skills, g.options);
    syncCodexCommandSkills([], g.skills, g.options);
    expect(readFileSync(join(g.root, "references/command.md"), "utf-8")).toBe("owner edited");
    expect(existsSync(join(g.root, "SKILL.md"))).toBe(true);
    expect(g.warn).toHaveBeenCalled();
  });

  it("does not follow a user symlink at a generated folder or leaf", () => {
    const f = fixture();
    const outside = join(homedir(), "bridge-owner-target");
    mkdirSync(outside, { recursive: true });
    mkdirSync(f.skills, { recursive: true });
    symlinkSync(outside, f.root);
    syncCodexCommandSkills([f.source], f.skills, f.options);
    expect(existsSync(join(outside, "SKILL.md"))).toBe(false);
    const g = fixture();
    syncCodexCommandSkills([g.source], g.skills, g.options);
    unlinkSync(join(g.root, "SKILL.md"));
    const owner = join(outside, "owner.md");
    writeFileSync(owner, "owner bytes");
    symlinkSync(owner, join(g.root, "SKILL.md"));
    syncCodexCommandSkills([g.source], g.skills, g.options);
    syncCodexCommandSkills([], g.skills, g.options);
    expect(readFileSync(owner, "utf-8")).toBe("owner bytes");
  });

  it("dry runs change neither generated files nor ownership", () => {
    const f = fixture();
    expect(syncCodexCommandSkills([f.source], f.skills, { ...f.options, dryRun: true })).toMatchObject({
      updatedFiles: 3,
      prunedFiles: 0,
    });
    expect(existsSync(f.root)).toBe(false);
    expect(f.manifest.hashes).toEqual({});
    syncCodexCommandSkills([f.source], f.skills, f.options);
    const hashes = { ...f.manifest.hashes };
    syncCodexCommandSkills([], f.skills, { ...f.options, dryRun: true });
    expect(f.manifest.hashes).toEqual(hashes);
    expect(existsSync(join(f.root, "SKILL.md"))).toBe(true);
  });

  it("prunes only unchanged owned leaves and preserves extra files and folders", () => {
    const f = fixture();
    syncCodexCommandSkills([f.source], f.skills, f.options);
    writeFileSync(join(f.root, "notes.txt"), "owner notes");
    syncCodexCommandSkills([], f.skills, { ...f.options, prune: false });
    expect(existsSync(join(f.root, "SKILL.md"))).toBe(true);
    syncCodexCommandSkills([], f.skills, f.options);
    expect(existsSync(join(f.root, "SKILL.md"))).toBe(false);
    expect(readFileSync(join(f.root, "notes.txt"), "utf-8")).toBe("owner notes");
    expect(Object.keys(f.manifest.hashes)).toHaveLength(3);
  });

  it("can restore a removed source while preserving extra owner files in the retained folder", () => {
    const f = fixture();
    syncCodexCommandSkills([f.source], f.skills, f.options);
    writeFileSync(join(f.root, "notes.txt"), "owner notes");
    syncCodexCommandSkills([], f.skills, f.options);
    syncCodexCommandSkills([f.source], f.skills, f.options);
    expect(readFileSync(join(f.root, "references/command.md"), "utf-8")).toBe(f.source.content);
    expect(readFileSync(join(f.root, "notes.txt"), "utf-8")).toBe("owner notes");
  });

  it("checks every required native leaf and flags a changed reference", () => {
    const f = fixture();
    expect(codexCommandSkillDrift([f.source], f.skills)).toHaveLength(3);
    syncCodexCommandSkills([f.source], f.skills, f.options);
    expect(codexCommandSkillDrift([f.source], f.skills)).toEqual([]);
    for (const leaf of codexCommandSkillFiles(f.source).keys()) {
      const path = join(f.root, leaf);
      const bytes = readFileSync(path, "utf-8");
      unlinkSync(path);
      expect(codexCommandSkillDrift([f.source], f.skills)).toEqual([path]);
      writeFileSync(path, bytes);
    }
    writeFileSync(join(f.root, "references/command.md"), "changed");
    expect(codexCommandSkillDrift([f.source], f.skills)).toEqual([join(f.root, "references/command.md")]);
  });

  it("uses tracked content ownership instead of a trusted-looking name for the unmanaged report", () => {
    const f = fixture();
    mkdirSync(f.root, { recursive: true });
    const path = join(f.root, "SKILL.md");
    writeFileSync(path, "owner");
    expect(unmanagedAgentSkills(f.skills, f.manifest)).toEqual([codexCommandSkillName(f.source.filename)]);
    f.manifest.hashes[path] = contentHash("owner");
    expect(unmanagedAgentSkills(f.skills, f.manifest)).toEqual([]);
    writeFileSync(path, "edited");
    expect(unmanagedAgentSkills(f.skills, f.manifest)).toEqual([codexCommandSkillName(f.source.filename)]);
  });
});
