import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ cache: "", ownerFile: "", calls: 0, unreadable: "", failCreatorFetch: false }));
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn((path: Parameters<typeof actual.readFileSync>[0], ...args: unknown[]) => {
      if (String(path) === fixture.unreadable) {
        throw Object.assign(new Error("SYNTHETIC_POLICY_PRIVATE_FIXTURE"), { code: "EACCES" });
      }
      return Reflect.apply(actual.readFileSync, actual, [path, ...args]);
    }),
  };
});
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFileSync: vi.fn(),
}));
vi.mock("./catalog/index-source.js", async (original) => ({
  ...(await original<typeof import("./catalog/index-source.js")>()),
  getSourceCachePath: vi.fn((source: { url: string }) =>
    source.url === "anthropics/skills" && fixture.failCreatorFetch ? undefined : fixture.cache,
  ),
  indexAllSources: vi.fn(async () => {
    writeFileSync(join(fixture.cache, "managed-fixture/SKILL.md"), "MANAGED_NEW_FIXTURE\n");
  }),
}));
vi.mock("./skills/skill-versions.js", async (original) => ({
  ...(await original<typeof import("./skills/skill-versions.js")>()),
  recordSourceShas: vi.fn(async () => new Map()),
}));
vi.mock("./sync/mcp-sync.js", () => ({ syncMcpServers: vi.fn() }));
vi.mock("./sync/rules-sync.js", async (original) => ({
  ...(await original<typeof import("./sync/rules-sync.js")>()),
  syncRules: vi.fn(),
}));
vi.mock("./sync/command-sync.js", () => ({ syncCommands: vi.fn() }));
vi.mock("./sync/agents-sync.js", () => ({ syncAgentDefs: vi.fn() }));
vi.mock("./sync/hooks-sync.js", () => ({ syncHooks: vi.fn() }));
vi.mock("./sync/model-sync.js", () => ({ syncModels: vi.fn() }));
vi.mock("./sync/instructions-sync.js", () => ({ syncInstructions: vi.fn() }));
vi.mock("./catalog/install-other.js", async (original) => ({
  ...(await original<typeof import("./catalog/install-other.js")>()),
  refreshRecommendedCatalogRules: vi.fn(() => ({ refreshed: [], unchanged: 0 })),
}));
vi.mock("./motd.js", () => ({ printMotd: vi.fn() }));

import { indexAllSources } from "./catalog/index-source.js";
import * as catalog from "./catalog/types.js";
import { buildProgram } from "./cli.js";
import { loadManifest, saveManifest } from "./manifest.js";
import { defaultState, loadState, saveState } from "./state.js";
import { AGENT_DEFINITIONS } from "./types.js";
import { update } from "./update.js";

const creator = "skill-creator";
const managed = "managed-fixture";
function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
function ownerPath(host: string): string {
  return join(homedir(), host, "skills", creator);
}
function marker(): string {
  return join(homedir(), "owner-audit-fixture.txt");
}
function requested(names = [creator, managed]): void {
  saveState({ ...loadState()!, agentfileSkills: names });
}
async function expectProtected(): Promise<void> {
  await update();
  expect(fixture.calls).toBe(0);
  expect(readFileSync(marker(), "utf-8")).toBe("OWNER_UNCHANGED\n");
  expect(indexAllSources).toHaveBeenCalledOnce();
  const staged = join(homedir(), ".config/agentbrew/installed-skills", managed, "SKILL.md");
  expect(readFileSync(staged, "utf-8")).toBe("MANAGED_NEW_FIXTURE\n");
  expect(readFileSync(join(homedir(), ".claude/skills", managed, "SKILL.md"), "utf-8")).toBe("MANAGED_NEW_FIXTURE\n");
  const output = vi.mocked(console.log).mock.calls.flat().join("\n");
  expect(output).toContain("External skills updater withheld");
  expect(output).not.toMatch(/All skills up to date|Skills updated/);
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.calls = 0;
  fixture.ownerFile = "";
  fixture.unreadable = "";
  fixture.failCreatorFetch = false;
  process.exitCode = undefined;
  for (const path of [
    ".agents",
    ".claude",
    ".codex",
    ".config/agentbrew",
    "foreign-owner-fixture",
    "workspace-policy-fixture",
  ]) {
    rmSync(join(homedir(), path), { recursive: true, force: true });
  }
  fixture.cache = join(homedir(), "public-upstream-fixture");
  write(join(fixture.cache, managed, "SKILL.md"), "MANAGED_OLD_FIXTURE\n");
  write(join(fixture.cache, creator, "SKILL.md"), "PUBLIC_CREATOR_FIXTURE\n");
  write(join(homedir(), ".config/agentbrew/installed-skills", managed, "SKILL.md"), "MANAGED_OLD_FIXTURE\n");
  write(marker(), "OWNER_UNCHANGED\n");
  process.env.AGENTBREW_DIR = join(homedir(), "empty-repo-fixture");
  mkdirSync(process.env.AGENTBREW_DIR, { recursive: true });
  const project = join(homedir(), "project-policy-fixture");
  rmSync(project, { recursive: true, force: true });
  mkdirSync(project, { recursive: true });
  vi.spyOn(process, "cwd").mockReturnValue(project);
  saveState({
    ...defaultState(),
    agents: AGENT_DEFINITIONS.filter((agent) => ["claude-code", "codex"].includes(agent.name)).map((agent) => ({
      ...agent,
      detected: agent.name === "claude-code",
    })),
    sources: [
      {
        url: "example/managed-skills",
        type: "github",
        skillsInstalled: [managed],
        availableItems: [],
        addedAt: "2026-01-01",
      },
    ],
    skillSourceDirs: [{ label: "installed-skills", path: "~/.config/agentbrew/installed-skills" }],
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(execFileSync).mockImplementation((command, args) => {
    if (command === "npx" && args?.[0] === "skills" && ["check", "update"].includes(String(args[1]))) {
      fixture.calls++;
      write(marker(), "EXTERNAL_WRITE_ATTEMPT\n");
      if (fixture.ownerFile) write(fixture.ownerFile, "EXTERNAL_OWNER_WRITE\n");
      return (args[1] === "check" ? "outdated" : "updated") as never;
    }
    return "" as never;
  });
});
afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("external updater owner preservation", () => {
  it.each(["global", "project"])("reads a first %s request in the central update handler", async (scope) => {
    const path =
      scope === "global" ? join(homedir(), ".config/agentbrew/Agentfile.yaml") : join(process.cwd(), "Agentfile.yaml");
    write(path, "skills: [skill-creator]\n");
    fixture.ownerFile = join(ownerPath(".agents"), "SKILL.md");
    write(fixture.ownerFile, "DIRECT_OWNER_FIXTURE\n");
    await expectProtected();
    expect(readFileSync(fixture.ownerFile, "utf-8")).toBe("DIRECT_OWNER_FIXTURE\n");
  });

  it.each(
    ["global", "project", "explicit", "workspace"].flatMap((scope) =>
      ["malformed", "unreadable"].map((failure) => [scope, failure]),
    ),
  )("aborts present %s %s policy without logging its contents", async (scope, failure) => {
    saveState({ ...defaultState(), agents: [], sources: [] });
    let path =
      scope === "global" ? join(homedir(), ".config/agentbrew/Agentfile.yaml") : join(process.cwd(), "Agentfile.yaml");
    if (scope === "workspace") {
      const root = join(homedir(), "workspace-policy-fixture");
      path = join(root, "repo-fixture/Agentfile.yaml");
      write(join(homedir(), ".config/agentbrew/Agentfile.yaml"), `workspaceRoots: [${JSON.stringify(root)}]\n`);
    }
    write(path, failure === "malformed" ? "skills: [SYNTHETIC_POLICY_PRIVATE_FIXTURE\n" : "skills: [skill-creator]\n");
    fixture.unreadable = failure === "unreadable" ? path : "";
    fixture.ownerFile = join(ownerPath(".agents"), "SKILL.md");
    write(fixture.ownerFile, "INVALID_POLICY_OWNER_FIXTURE\n");
    if (scope === "explicit" || scope === "workspace") {
      await buildProgram().parseAsync([
        "node",
        "test",
        "sync",
        "--pull",
        ...(scope === "explicit" ? ["--agentfile", path] : []),
      ]);
    } else await update();
    expect(fixture.calls).toBe(0);
    expect(process.exitCode).toBe(1);
    expect(indexAllSources).not.toHaveBeenCalled();
    expect(readFileSync(fixture.ownerFile, "utf-8")).toBe("INVALID_POLICY_OWNER_FIXTURE\n");
    const errors = [...vi.mocked(console.error).mock.calls, ...vi.mocked(console.warn).mock.calls].flat().join("\n");
    expect(errors).toMatch(/Agentfile.*(invalid|unreadable|aborted)|(?:invalid|unreadable).*Agentfile/i);
    expect(errors).not.toContain("SYNTHETIC_POLICY_PRIVATE_FIXTURE");
    expect(errors).not.toContain("skills: [");
    fixture.unreadable = "";
  });

  it("keeps missing optional policy ordinary but clearly aborts a missing explicit policy", async () => {
    await update();
    expect(fixture.calls).toBe(2);
    expect(process.exitCode).toBeUndefined();
    fixture.calls = 0;
    await buildProgram().parseAsync([
      "node",
      "test",
      "sync",
      "--pull",
      "--agentfile",
      join(process.cwd(), "missing-policy.yaml"),
    ]);
    expect(fixture.calls).toBe(0);
    expect(process.exitCode).toBe(1);
  });

  it.each([
    ".agents",
    ".codex",
  ])("keeps a first-requested %s broken owner when the creator fetch fails", async (host) => {
    const policy = join(homedir(), ".config/agentbrew/Agentfile.yaml");
    write(policy, "skills: [skill-creator, managed-fixture]\nsources: [example/managed-skills, anthropics/skills]\n");
    const target = join(homedir(), "failed-install-owner-missing");
    mkdirSync(dirname(ownerPath(host)), { recursive: true });
    symlinkSync(target, ownerPath(host));
    fixture.failCreatorFetch = true;
    await buildProgram().parseAsync(["node", "test", "sync", "--pull", "--no-prune", "--agentfile", policy]);
    expect(fixture.calls).toBe(0);
    expect(readlinkSync(ownerPath(host))).toBe(target);
    expect(existsSync(join(homedir(), ".config/agentbrew/installed-skills", creator))).toBe(false);
    expect(loadManifest().localSkillLinks?.[ownerPath(host)]).toBeUndefined();
    expect(loadManifest().localSkillConflicts).toContain(ownerPath(host));
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    write(policy, "skills: [managed-fixture]\nsources: [example/managed-skills]\n");
    await update();
    expect(fixture.calls).toBe(0);
    expect(readlinkSync(ownerPath(host))).toBe(target);
    expect(loadManifest().localSkillLinks?.[ownerPath(host)]).toBeUndefined();
    expect(loadManifest().localSkillConflicts).toContain(ownerPath(host));
  });

  it("withholds the opaque updater on unchanged receipt-managed creator links while managed refresh continues", async () => {
    const staged = join(homedir(), ".config/agentbrew/installed-skills", creator);
    write(join(staged, "SKILL.md"), "OLD_MANAGED_CREATOR_FIXTURE\n");
    saveState({
      ...loadState()!,
      sources: [
        ...loadState()!.sources!,
        {
          url: "anthropics/skills",
          type: "github",
          skillsInstalled: [creator],
          availableItems: [],
          addedAt: "2026-01-01",
        },
      ],
    });
    const receipts: Record<string, string> = {};
    for (const host of [".agents", ".claude", ".codex"]) {
      mkdirSync(dirname(ownerPath(host)), { recursive: true });
      symlinkSync(staged, ownerPath(host));
      receipts[ownerPath(host)] = staged;
    }
    saveManifest({ hashes: {}, localSkillLinks: receipts });
    await expectProtected();
    expect(readFileSync(join(staged, "SKILL.md"), "utf-8")).toBe("PUBLIC_CREATOR_FIXTURE\n");
    for (const dest of Object.keys(receipts)) expect(readlinkSync(dest)).toBe(staged);
  });

  it("protects a requested shared owner before the requested catalog skill has been installed", async () => {
    fixture.ownerFile = join(ownerPath(".agents"), "SKILL.md");
    write(fixture.ownerFile, "SHARED_OWNER_FIXTURE\n");
    await update({ requestedSkills: [creator] });
    expect(fixture.calls).toBe(0);
    expect(readFileSync(fixture.ownerFile, "utf-8")).toBe("SHARED_OWNER_FIXTURE\n");
    expect(indexAllSources).toHaveBeenCalledOnce();
    expect(readFileSync(join(homedir(), ".claude/skills", managed, "SKILL.md"), "utf-8")).toBe("MANAGED_NEW_FIXTURE\n");
  });

  it("withholds both mutating commands for authoritative requested owners", async () => {
    requested();
    fixture.ownerFile = join(ownerPath(".agents"), "SKILL.md");
    write(fixture.ownerFile, "OWNER_FIXTURE\n");
    await expectProtected();
    expect(readFileSync(fixture.ownerFile, "utf-8")).toBe("OWNER_FIXTURE\n");
  });

  it.each(["foreign", "broken"])("protects a selected %s link on an excluded host", async (kind) => {
    const target = join(homedir(), "foreign-owner-fixture");
    if (kind === "foreign") write(join(target, "SKILL.md"), "FOREIGN_OWNER_FIXTURE\n");
    mkdirSync(dirname(ownerPath(".codex")), { recursive: true });
    symlinkSync(target, ownerPath(".codex"));
    const state = loadState()!;
    saveState({
      ...state,
      sources: [
        ...state.sources!,
        {
          url: "anthropics/skills",
          type: "github",
          skillsInstalled: [creator],
          availableItems: [],
          addedAt: "2026-01-01",
        },
      ],
    });
    await expectProtected();
    expect(readlinkSync(ownerPath(".codex"))).toBe(target);
    if (kind === "foreign") expect(readFileSync(join(target, "SKILL.md"), "utf-8")).toBe("FOREIGN_OWNER_FIXTURE\n");
    else expect(existsSync(target)).toBe(false);
  });

  it("honors retained owner conflicts after the catalog skill was deselected", async () => {
    requested([managed]);
    const target = join(homedir(), "missing-owner-fixture");
    mkdirSync(dirname(ownerPath(".codex")), { recursive: true });
    symlinkSync(target, ownerPath(".codex"));
    saveManifest({ hashes: {}, localSkillConflicts: [ownerPath(".codex")] });
    await expectProtected();
    expect(loadManifest().localSkillConflicts).toContain(ownerPath(".codex"));
  });

  it("recognizes a retargeted receipt before native reconciliation records its owner conflict", async () => {
    requested([managed]);
    mkdirSync(dirname(ownerPath(".codex")), { recursive: true });
    symlinkSync(join(homedir(), "missing-owner-fixture"), ownerPath(".codex"));
    saveManifest({
      hashes: {},
      localSkillLinks: { [ownerPath(".codex")]: join(homedir(), ".config/agentbrew/installed-skills", creator) },
    });
    await expectProtected();
  });

  it("retains default delegated updates when no protected owner path exists", async () => {
    requested();
    await update();
    expect(fixture.calls).toBe(2);
    expect(indexAllSources).toHaveBeenCalledOnce();
  });

  it("retains default delegated updates when the policy is off and no retained conflict exists", async () => {
    requested();
    write(join(ownerPath(".agents"), "SKILL.md"), "DEFAULT_OWNER_FIXTURE\n");
    const current = catalog.loadCatalog();
    vi.spyOn(catalog, "loadCatalog").mockReturnValue({
      ...current,
      skills: current.skills.map((entry) => ({ ...entry, preserveExisting: false })),
    });
    await update();
    expect(fixture.calls).toBe(2);
  });
});
