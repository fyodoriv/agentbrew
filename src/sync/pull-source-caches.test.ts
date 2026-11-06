import { execFile, execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFile: vi.fn(actual.execFile) };
});

const runtime = vi.hoisted(() => ({
  root: "",
  branch: "main" as string | undefined,
  update: vi.fn<() => Promise<"verified" | "refused-before-publication" | "partial-or-unknown">>(),
}));
vi.mock("../mcp/mcp-git.js", () => ({ GIT_CACHE_DIR: "/unused-fixture-root", updateMcpFromGit: runtime.update }));
vi.mock("../mcp/git-candidate.js", () => ({
  registeredRuntime: () => runtime.root,
  inspectRuntime: () => ({ branch: runtime.branch }),
}));
vi.mock("./mcp-sync.js", () => ({ syncMcpServers: vi.fn() }));
vi.mock("./rules-sync.js", () => ({ syncRules: vi.fn() }));
vi.mock("./skills-sync.js", () => ({ syncSkills: vi.fn() }));
vi.mock("./command-sync.js", () => ({ syncCommands: vi.fn() }));
vi.mock("./agents-sync.js", () => ({ syncAgentDefs: vi.fn() }));
vi.mock("./hooks-sync.js", () => ({ syncHooks: vi.fn() }));
vi.mock("./model-sync.js", () => ({ syncModels: vi.fn() }));
vi.mock("./instructions-sync.js", () => ({ syncInstructions: vi.fn() }));
vi.mock("../catalog/types.js", () => ({ loadCatalog: () => ({ skills: [], rules: [], mcp: [] }) }));

import { getSourceCacheDir, getSourceCachePath, indexAllSources, resetSessionCache } from "../catalog/index-source.js";
import { SourceCheckoutLeaseRefusal, withSourceCheckoutLeases } from "../catalog/source-checkout-lease.js";
import { readLock, writeLock } from "../lock.js";
import { defaultState, loadState, saveState } from "../state.js";
import type { Source } from "../types.js";
import { update } from "../update.js";
import { pullReadCheckouts } from "./pull-source-caches.js";

let root: string;
let previousExit: typeof process.exitCode;
let retainFixture = false;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: "pipe",
    timeout: 10_000,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "agentbrew fixture",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "agentbrew fixture",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  }).trim();
}

function commit(repo: string, body: string): string {
  const skill = join(repo, "skills", "fixture");
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), `---\nname: fixture\ndescription: fixture\n---\n${body}\n`);
  git(repo, "add", "skills/fixture/SKILL.md");
  git(repo, "-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", body);
  return git(repo, "rev-parse", "HEAD");
}

function fixture(name = "origin"): { repo: string; source: Source; cache: string } {
  const repo = join(root, name);
  mkdirSync(repo);
  git(repo, "init", "--quiet", "-b", "main");
  commit(repo, "old fixture bytes");
  const source: Source = {
    url: pathToFileURL(repo).href,
    type: "url",
    skillsInstalled: ["fixture"],
    availableItems: [],
    addedAt: "2026-11-05",
  };
  const cache = getSourceCachePath(source);
  expect(cache).toBeDefined();
  return { repo, source, cache: cache! };
}

interface GatedGitCall {
  path: string;
  checkoutKey: string;
  args: string[];
  options: { cwd?: string; env?: NodeJS.ProcessEnv };
  callback: (error: Error | null, stdout: string, stderr: string) => void;
  completed: boolean;
}

function gatedGit() {
  const calls: GatedGitCall[] = [];
  let active = 0;
  let maxActive = 0;
  let maxSamePath = 0;
  vi.mocked(execFile).mockImplementation(((
    _command: string,
    args: string[],
    options: GatedGitCall["options"],
    callback: GatedGitCall["callback"],
  ) => {
    const path = args[0] === "clone" ? args.at(-1)! : options.cwd!;
    const checkoutKey = args[0] === "clone" ? path : realpathSync.native(path);
    calls.push({ path, checkoutKey, args, options, callback, completed: false });
    active += 1;
    maxActive = Math.max(maxActive, active);
    maxSamePath = Math.max(
      maxSamePath,
      calls.filter((call) => !call.completed && call.checkoutKey === checkoutKey).length,
    );
  }) as never);
  const release = (call: GatedGitCall) => {
    call.completed = true;
    active -= 1;
    try {
      const stdout = execFileSync("git", call.args, {
        ...call.options,
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 10_000,
      });
      call.callback(null, stdout, "");
    } catch (error) {
      call.callback(error as Error, "", "fixture Git failed");
    }
  };
  const flush = async () => {
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
  };
  const drain = async (completion?: Promise<unknown>) => {
    let finished = false;
    completion?.then(
      () => {
        finished = true;
      },
      () => {
        finished = true;
      },
    );
    const end = Date.now() + 60_000;
    for (let round = 0; completion ? !finished : round < 30; round++) {
      for (const call of calls.filter((candidate) => !candidate.completed)) release(call);
      await flush();
      if (completion && !finished) {
        if (Date.now() >= end) throw new Error("fixture callback cleanup expired; invalid measurement");
        await new Promise((done) => setTimeout(done, 10));
      }
    }
    if (completion) await completion;
  };
  return { calls, release, flush, drain, maxActive: () => maxActive, maxSamePath: () => maxSamePath };
}

interface FixtureChildResult {
  code: number | null;
  output: string;
}

function productionChild(home: string, code: string) {
  const repoRoot = process.cwd();
  const sourceRoot = pathToFileURL(`${join(repoRoot, "src")}/`).href;
  const isolatedCode = code.replaceAll('"./src/', `"${sourceRoot}`);
  const loader = pathToFileURL(join(repoRoot, "node_modules/tsx/dist/loader.mjs")).href;
  const child = spawn(process.execPath, ["--import", loader, "--input-type=module", "--eval", isolatedCode], {
    cwd: home,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      AGENTBREW_DIR: home,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let done = false;
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });
  const finished = new Promise<FixtureChildResult>((resolveChild) => {
    child.once("error", () => {
      done = true;
      resolveChild({ code: null, output: "fixture child spawn failed" });
    });
    child.once("close", (code) => {
      done = true;
      writeFileSync(join(root, `fixture-child-${child.pid}.log`), output);
      if (code !== 0) {
        retainFixture = true;
        console.log(`Fixture child log retained in ${root}`);
      }
      resolveChild({ code, output });
    });
  });
  return { finished, output: () => output, done: () => done };
}

async function fixtureHandshake(ready: () => boolean): Promise<void> {
  const end = Date.now() + 60_000;
  while (!ready()) {
    if (Date.now() >= end) throw new Error("fixture handshake expired; invalid measurement");
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}

async function fixtureChildResult(child: ReturnType<typeof productionChild>): Promise<FixtureChildResult> {
  await fixtureHandshake(child.done);
  return child.finished;
}

async function cleanupFixtureChildren(children: ReturnType<typeof productionChild>[]): Promise<void> {
  try {
    await Promise.all(children.map(fixtureChildResult));
  } catch (error) {
    retainFixture = true;
    throw new Error(`fixture cleanup incomplete; retained ${root}`, { cause: error });
  }
}

function fixtureRecord<T>(result: FixtureChildResult, prefix: string): T {
  const line = result.output.split("\n").find((candidate) => candidate.startsWith(prefix));
  if (!line) throw new Error(`fixture outcome absent; inspect child logs in ${root}`);
  return JSON.parse(line.slice(prefix.length)) as T;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(execFile).mockReset();
  root = mkdtempSync(join(tmpdir(), "agentbrew-pull-780-"));
  retainFixture = false;
  previousExit = process.exitCode;
  process.exitCode = undefined;
  resetSessionCache();
  runtime.branch = "main";
  runtime.update.mockReset().mockResolvedValue("verified");
});

afterEach(() => {
  process.exitCode = previousExit;
  vi.unstubAllEnvs();
  if (!retainFixture) rmSync(root, { recursive: true, force: true });
});

describe("explicit pull source bytes (#780)", () => {
  it("fast-forwards a clean registered remote cache before reading artifacts", async () => {
    const { repo, source, cache } = fixture();
    const next = commit(repo, "new fixture bytes");
    resetSessionCache();
    const outcomes = (await indexAllSources([source], { explicitPull: true })) ?? [];
    expect(outcomes[0]).toMatchObject({ status: "refreshed", sha: next });
    expect(git(cache, "rev-parse", "HEAD")).toBe(next);
    expect(readFileSync(join(cache, "skills", "fixture", "SKILL.md"), "utf-8")).toContain("new fixture bytes");
  });
  it("refreshes a cache even after a prior same-process source read", async () => {
    const { repo, source, cache } = fixture();
    const next = commit(repo, "new fixture bytes");
    await indexAllSources([source], { explicitPull: true });
    expect(git(cache, "rev-parse", "HEAD")).toBe(next);
    expect(readFileSync(join(cache, "skills", "fixture", "SKILL.md"), "utf-8")).toContain("new fixture bytes");
  });

  it("never records remote HEAD as the revision of older deployed cache bytes", async () => {
    const { repo, source, cache } = fixture();
    commit(repo, "new fixture bytes");
    saveState({ ...defaultState(), sources: [source] });
    await update({ skillName: "fixture" });
    const recorded = loadState()?.sources?.[0]?.commitSha;
    expect(recorded).toBe(git(cache, "rev-parse", "HEAD"));
  });

  it("reports a refused origin refresh without changing cache bytes or claiming completion", async () => {
    const { repo, source, cache } = fixture();
    const before = git(cache, "rev-parse", "HEAD");
    commit(repo, "new fixture bytes");
    git(cache, "remote", "set-url", "origin", join(root, "unrelated-origin"));
    saveState({ ...defaultState(), sources: [source] });
    const logs = vi.spyOn(console, "log");
    await update({ skillName: "fixture" });
    expect(process.exitCode).toBe(1);
    expect(git(cache, "rev-parse", "HEAD")).toBe(before);
    expect(readFileSync(join(cache, "skills", "fixture", "SKILL.md"), "utf-8")).toContain("old fixture bytes");
    expect(logs.mock.calls.flat().join("\n")).toContain("refresh errors");
    expect(logs.mock.calls.flat().join("\n")).not.toContain("✓ Update complete");
  });

  it("does not advance a lock to remote HEAD when local changes make the read revision unverified", async () => {
    const { repo, source, cache } = fixture();
    const before = git(cache, "rev-parse", "HEAD");
    writeLock({
      locked: [{ source: source.url, type: source.type, sha: before, skills: ["fixture"], lockedAt: "2026-11-05" }],
    });
    writeFileSync(join(cache, "skills", "fixture", "SKILL.md"), "owner work\n");
    commit(repo, "new fixture bytes");
    saveState({ ...defaultState(), sources: [source] });
    await update({ skillName: "fixture" });
    expect(readLock().locked[0]?.sha).toBe(before);
    expect(loadState()?.sources?.[0]?.commitSha).toBeUndefined();
  });

  it.each([
    "post-merge",
    "post-checkout",
  ] as const)("does not accept a revision when a fixture %s hook changes tracked artifact bytes", async (hookName) => {
    const { repo, source, cache } = fixture();
    const before = git(cache, "rev-parse", "HEAD");
    writeLock({
      locked: [{ source: source.url, type: source.type, sha: before, skills: ["fixture"], lockedAt: "2026-11-05" }],
    });
    const hooks = join(root, "hooks");
    mkdirSync(hooks);
    writeFileSync(join(hooks, hookName), '#!/bin/sh\nprintf "fixture hook edit\\n" >> skills/fixture/SKILL.md\n', {
      mode: 0o755,
    });
    const config = join(root, "fixture.gitconfig");
    writeFileSync(config, `[core]\n\thooksPath = ${hooks}\n`);
    vi.stubEnv("GIT_CONFIG_GLOBAL", config);
    commit(repo, "new fixture bytes");
    if (hookName === "post-checkout") rmSync(cache, { recursive: true, force: true });
    const outcomes = await indexAllSources([source], { explicitPull: true });
    expect(readFileSync(join(cache, "skills", "fixture", "SKILL.md"), "utf-8")).toContain("fixture hook edit");
    expect(git(cache, "status", "--porcelain")).toContain("skills/fixture/SKILL.md");
    expect(outcomes[0]?.status).not.toMatch(/^(refreshed|unchanged)$/);
    expect(outcomes[0]?.sha).toBeUndefined();
    expect(source.commitSha).toBeUndefined();
    saveState({ ...defaultState(), sources: [source] });
    await update({ skillName: "fixture" });
    expect(readLock().locked[0]?.sha).toBe(before);
    expect(loadState()?.sources?.[0]?.commitSha).toBeUndefined();
    expect(readFileSync(join(cache, "skills", "fixture", "SKILL.md"), "utf-8")).toContain("fixture hook edit");
    expect(readFileSync(config, "utf-8")).toContain(hooks);
    expect(readFileSync(join(hooks, hookName), "utf-8")).toContain("fixture hook edit");
  });

  it("reports ownership of a local artifact checkout without silently pulling it", async () => {
    const { repo } = fixture();
    const logs = vi.spyOn(console, "log");
    const before = git(repo, "rev-parse", "HEAD");
    const result = await pullReadCheckouts(
      { ...defaultState(), commandSourceDirs: [{ label: "fixture", path: join(repo, "skills") }] },
      [],
      { dryRun: false },
    );
    expect(result).toEqual({ skipped: 1, failed: 0 });
    expect(logs.mock.calls.flat().join("\n")).toContain("owner-managed Git checkout");
    expect(logs.mock.calls.flat().join("\n")).toContain("agentbrew sync --pull");
    expect(git(repo, "rev-parse", "HEAD")).toBe(before);
  });

  it("uses the verified MCP updater and identifies artifact reads pinned inside the old runtime", async () => {
    const { repo } = fixture();
    runtime.root = repo;
    const state = {
      ...defaultState(),
      mcpServers: [
        {
          name: "fixture-mcp",
          command: "node",
          args: [join(repo, "server.js")],
          env: {},
          source: "user",
          gitUrl: pathToFileURL(repo).href,
          gitRef: "main",
        },
      ],
      skillSourceDirs: [{ label: "fixture-runtime", path: join(repo, "skills") }],
    };
    saveState(state);
    const before = git(repo, "rev-parse", "HEAD");
    const logs = vi.spyOn(console, "log");
    const result = await pullReadCheckouts(state, [], { dryRun: false });
    expect(runtime.update).toHaveBeenCalledExactlyOnceWith("fixture-mcp");
    expect(result).toEqual({ skipped: 1, failed: 0 });
    expect(logs.mock.calls.flat().join("\n")).toContain("explicit path retains MCP fixture-mcp's previous runtime");
    expect(git(repo, "rev-parse", "HEAD")).toBe(before);
  });

  it("does not claim candidate verification when its updater refuses and an earlier error is already present", async () => {
    const { repo } = fixture();
    runtime.root = repo;
    runtime.update.mockResolvedValue("refused-before-publication");
    process.exitCode = 1;
    const state = {
      ...defaultState(),
      mcpServers: [
        { name: "fixture-mcp", command: "node", args: [], env: {}, source: "user", gitUrl: pathToFileURL(repo).href },
      ],
    };
    saveState(state);
    const logs = vi.spyOn(console, "log");
    expect(await pullReadCheckouts(state, [], { dryRun: false })).toEqual({ skipped: 0, failed: 1 });
    expect(logs.mock.calls.flat().join("\n")).not.toContain("verified candidate update");
  });

  it("refreshes source bytes and receipts without publishing an excluded MCP runtime", async () => {
    const { repo, source, cache } = fixture();
    writeLock({
      locked: [
        {
          source: source.url,
          type: source.type,
          sha: git(cache, "rev-parse", "HEAD"),
          skills: ["fixture"],
          lockedAt: "2026-11-05",
        },
      ],
    });
    runtime.root = repo;
    const state = {
      ...defaultState(),
      sources: [source],
      mcpServers: [
        {
          name: "fixture-mcp",
          command: "node",
          args: [join(repo, "server.js")],
          env: {},
          source: "user",
          gitUrl: pathToFileURL(repo).href,
          gitRef: "main",
        },
      ],
      skillSourceDirs: [{ label: "fixture-runtime", path: join(repo, "skills") }],
    };
    saveState(state);
    const server = JSON.stringify(loadState()?.mcpServers);
    const fresh = commit(repo, "new selected pull bytes");
    const runtimeBytes = readFileSync(join(repo, "skills/fixture/SKILL.md"), "utf8");
    const logs = vi.spyOn(console, "log");
    await update({ only: "skills,hooks", skillName: "fixture" });
    expect(runtime.update).not.toHaveBeenCalled();
    expect(git(repo, "rev-parse", "HEAD")).toBe(fresh);
    expect(readFileSync(join(repo, "skills/fixture/SKILL.md"), "utf8")).toBe(runtimeBytes);
    expect(JSON.stringify(loadState()?.mcpServers)).toBe(server);
    expect(git(cache, "rev-parse", "HEAD")).toBe(fresh);
    expect(readLock().locked.find((entry) => entry.source === source.url)?.sha).toBe(fresh);
    expect(logs.mock.calls.flat().join("\n")).toContain("MCP fixture-mcp — skipped: MCP module not selected");
    expect(logs.mock.calls.flat().join("\n")).not.toContain("Fast-forward this checkout explicitly");
  });

  it("reports a pinned MCP runtime without invoking an updater or changing its files", async () => {
    const { repo } = fixture();
    runtime.root = repo;
    runtime.branch = undefined;
    const state = {
      ...defaultState(),
      mcpServers: [
        { name: "fixture-mcp", command: "node", args: [], env: {}, source: "user", gitUrl: pathToFileURL(repo).href },
      ],
    };
    const logs = vi.spyOn(console, "log");
    expect(await pullReadCheckouts(state, [], { dryRun: false })).toEqual({ skipped: 1, failed: 0 });
    expect(runtime.update).not.toHaveBeenCalled();
    expect(logs.mock.calls.flat().join("\n")).toContain("pinned runtime");
  });

  it.each([
    "dirty",
    "diverged",
    "pinned",
  ] as const)("preserves a %s checkout and explains its decision", async (kind) => {
    const { repo, source, cache } = fixture();
    if (kind === "dirty") writeFileSync(join(cache, "skills", "fixture", "SKILL.md"), "owner work\n");
    if (kind === "diverged") commit(cache, "cache-only fixture work");
    if (kind === "pinned") git(cache, "checkout", "--quiet", "--detach", "HEAD");
    const before = git(cache, "rev-parse", "HEAD");
    const bytes = readFileSync(join(cache, "skills", "fixture", "SKILL.md"), "utf-8");
    commit(repo, "new fixture bytes");
    const outcomes = (await indexAllSources([source], { explicitPull: true })) ?? [];
    expect(outcomes[0]?.status).toBe(kind === "diverged" ? "failed" : "skipped");
    expect(outcomes[0]?.reason.length).toBeGreaterThan(0);
    expect(git(cache, "rev-parse", "HEAD")).toBe(before);
    expect(readFileSync(join(cache, "skills", "fixture", "SKILL.md"), "utf-8")).toBe(bytes);
    if (kind === "dirty") expect(source.commitSha).toBeUndefined();
  });

  it("does not pull or deploy changed source bytes during a dry run", async () => {
    const { repo, source, cache } = fixture();
    const before = git(cache, "rev-parse", "HEAD");
    const bytes = readFileSync(join(cache, "skills", "fixture", "SKILL.md"), "utf-8");
    commit(repo, "new fixture bytes");
    resetSessionCache();
    saveState({ ...defaultState(), sources: [source] });
    const state = JSON.stringify(loadState());
    await update({ skillName: "fixture", dryRun: true });
    expect(git(cache, "rev-parse", "HEAD")).toBe(before);
    expect(readFileSync(join(cache, "skills", "fixture", "SKILL.md"), "utf-8")).toBe(bytes);
    expect(JSON.stringify(loadState())).toBe(state);
  });
});

describe("explicit pull bounded progress (#780)", () => {
  it("copies the accepted revision when another invocation refreshes its cache while an independent source is held", async () => {
    const first = fixture("receipt-x");
    const held = fixture("receipt-y");
    held.source.skillsInstalled = [];
    const previous = git(first.cache, "rev-parse", "HEAD");
    const accepted = commit(first.repo, "accepted invocation bytes");
    writeLock({
      locked: [
        {
          source: first.source.url,
          type: first.source.type,
          sha: previous,
          skills: ["fixture"],
          lockedAt: "2026-11-05",
        },
      ],
    });
    saveState({ ...defaultState(), sources: [first.source, held.source] });
    const gate = gatedGit();
    const updating = update({ skillName: "fixture" });
    let concurrent: Promise<unknown> | undefined;
    try {
      await gate.flush();
      const firstPull = gate.calls.find((call) => call.path === first.cache)!;
      gate.release(firstPull);
      await gate.flush();
      expect(git(first.cache, "rev-parse", "HEAD")).toBe(accepted);
      const newer = commit(first.repo, "newer concurrent bytes");
      concurrent = indexAllSources([{ ...first.source }], { explicitPull: true });
      await gate.flush();
      const earlySecondPull = gate.calls.find((call) => call.path === first.cache && !call.completed);
      if (earlySecondPull) {
        gate.release(earlySecondPull);
        await concurrent;
      }
      gate.release(gate.calls.find((call) => call.path === held.cache && !call.completed)!);
      await updating;
      if (!earlySecondPull) {
        await fixtureHandshake(() => gate.calls.some((call) => call.path === first.cache && !call.completed));
        gate.release(gate.calls.find((call) => call.path === first.cache && !call.completed)!);
        await concurrent;
      }
      expect(git(first.cache, "rev-parse", "HEAD")).toBe(newer);
      expect(loadState()?.sources?.find((source) => source.url === first.source.url)?.commitSha).toBe(accepted);
      expect(readLock().locked.find((entry) => entry.source === first.source.url)?.sha).toBe(accepted);
      const installed = join(homedir(), ".config", "agentbrew", "installed-skills", "fixture", "SKILL.md");
      expect(readFileSync(installed, "utf-8").trimEnd()).toBe(
        git(first.repo, "show", `${accepted}:skills/fixture/SKILL.md`),
      );
    } finally {
      await gate.drain(Promise.allSettled([updating, concurrent]));
      await Promise.all([updating, concurrent]);
    }
  });

  it("finishes an independent checkout while another is held, with bounded and duplicate-safe pulls", async () => {
    const fixtures = Array.from({ length: 10 }, (_, index) => fixture(`origin-${index}`));
    const sources = [...fixtures.map(({ source }) => source), { ...fixtures[0]!.source }, { ...fixtures[1]!.source }];
    const gate = gatedGit();
    const result = indexAllSources(sources, { explicitPull: true });
    try {
      await gate.flush();
      expect(gate.maxActive()).toBeGreaterThanOrEqual(2);
      expect(gate.maxActive()).toBeLessThanOrEqual(8);
      const held = gate.calls.find((call) => call.path === fixtures[0]!.cache)!;
      const independent = gate.calls.find((call) => call.path === fixtures[1]!.cache)!;
      gate.release(independent);
      await gate.flush();
      expect(fixtures[1]!.source.commitSha).toBe(git(fixtures[1]!.cache, "rev-parse", "HEAD"));
      expect(held.completed).toBe(false);
    } finally {
      await gate.drain();
      await result;
    }
    const outcomes = await result;
    expect(outcomes).toHaveLength(sources.length);
    expect(outcomes.every((outcome) => outcome.status === "unchanged" && outcome.sha)).toBe(true);
    expect(gate.calls).toHaveLength(fixtures.length);
    expect(gate.maxActive()).toBeLessThanOrEqual(8);
    expect(gate.maxSamePath()).toBe(1);
  }, 120_000);

  it("lets an independent fresh clone finish before a held clone", async () => {
    const first = fixture("clone-a");
    const second = fixture("clone-b");
    rmSync(first.cache, { recursive: true, force: true });
    rmSync(second.cache, { recursive: true, force: true });
    const gate = gatedGit();
    const result = indexAllSources([first.source, second.source], { explicitPull: true });
    try {
      await gate.flush();
      expect(gate.maxActive()).toBe(2);
      const independent = gate.calls.find((call) => call.path === second.cache)!;
      gate.release(independent);
      await gate.flush();
      expect(second.source.commitSha).toBe(git(second.cache, "rev-parse", "HEAD"));
      expect(gate.calls.find((call) => call.path === first.cache)?.completed).toBe(false);
    } finally {
      await gate.drain();
      await result;
    }
    expect((await result).every((outcome) => outcome.status === "refreshed")).toBe(true);
  });

  it("serializes one checkout across explicit invocations without sharing a freshness result", async () => {
    const { source } = fixture();
    const gate = gatedGit();
    const first = indexAllSources([source], { explicitPull: true });
    const second = indexAllSources([{ ...source }], { explicitPull: true });
    try {
      await gate.flush();
      expect(gate.calls).toHaveLength(1);
      gate.release(gate.calls[0]!);
      await fixtureHandshake(() => gate.calls.length >= 2);
      expect(gate.calls).toHaveLength(2);
      expect(gate.maxSamePath()).toBe(1);
    } finally {
      await gate.drain();
      await Promise.all([first, second]);
    }
    expect((await first)[0]?.sha).toBe((await second)[0]?.sha);
  });

  it("serializes different cache paths that alias one actual checkout", async () => {
    const { source, cache } = fixture();
    const alias = { ...source, url: `${source.url}/` };
    symlinkSync(cache, getSourceCacheDir(alias), "dir");
    const gate = gatedGit();
    const result = indexAllSources([source, alias], { explicitPull: true });
    try {
      await gate.flush();
      expect(gate.calls).toHaveLength(1);
      gate.release(gate.calls[0]!);
      await fixtureHandshake(() => gate.calls.length >= 2);
      expect(gate.calls).toHaveLength(2);
      expect(gate.maxSamePath()).toBe(1);
    } finally {
      await gate.drain();
      await result;
    }
    expect((await result).every((outcome) => outcome.status === "unchanged")).toBe(true);
  });

  it("does not reuse an accepted receipt for a conflicting source alias of the same cache path", async () => {
    const first = fixture("alias.a");
    const second = fixture("alias:a");
    expect(first.cache).toBe(second.cache);
    const gate = gatedGit();
    const result = indexAllSources([first.source, second.source], { explicitPull: true });
    await gate.drain();
    const outcomes = await result;
    expect(outcomes[0]?.status).toBe("unchanged");
    expect(outcomes[1]?.status).toBe("failed");
    expect(outcomes[1]?.sha).toBeUndefined();
    expect(gate.maxSamePath()).toBeLessThanOrEqual(1);
  });
});

describe("cross-process receipt-bound copy (#780)", () => {
  it("keeps copied bytes bound to the accepted revision across production updater processes", async () => {
    const home = join(root, "shared-child-home");
    mkdirSync(join(home, "templates"), { recursive: true, mode: 0o700 });
    writeFileSync(join(home, "templates", "AGENTS.md"), "Fixture instructions.\n");
    const x = fixture("cross-x");
    const y = fixture("cross-y");
    y.source.skillsInstalled = [];
    const childCache = (source: Source) =>
      join(home, ".cache", "agentbrew", "sources", source.url.replace(/[^a-zA-Z0-9_-]/g, "_"));
    for (const item of [x, y]) {
      mkdirSync(dirname(childCache(item.source)), { recursive: true });
      git(root, "clone", "--quiet", item.source.url, childCache(item.source));
    }
    const previous = git(x.cache, "rev-parse", "HEAD");
    const accepted = commit(x.repo, "accepted cross-process bytes");
    commit(y.repo, "held cross-process bytes");
    const release = join(root, "release-y");
    const ready = join(root, "ready-y");
    writeFileSync(
      join(childCache(y.source), ".git", "hooks", "post-merge"),
      `#!${process.execPath}\nconst fs = require("node:fs");\nfs.writeFileSync(${JSON.stringify(ready)}, "ready");\nconst end = Date.now() + 30000;\nwhile (!fs.existsSync(${JSON.stringify(release)})) { if (Date.now() >= end) process.exit(73); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); }\n`,
      { mode: 0o755 },
    );
    const initial = { ...defaultState(), sources: [x.source, y.source] };
    const lock = {
      locked: [
        { source: x.source.url, type: x.source.type, sha: previous, skills: ["fixture"], lockedAt: "2026-11-05" },
      ],
    };
    const a = productionChild(
      home,
      `import {update} from "./src/update.ts"; import {saveState,loadState} from "./src/state.ts"; import {writeLock,readLock} from "./src/lock.ts"; saveState(${JSON.stringify(initial)}); writeLock(${JSON.stringify(lock)}); update({skillName:"fixture"}).then(()=>console.log("FIXTURE_A_RESULT="+JSON.stringify({sources:loadState()?.sources,locked:readLock().locked}))).catch(()=>{console.error("fixture update failed");process.exitCode=1});`,
    );
    const children = [a];
    try {
      await fixtureHandshake(
        () => a.done() || (existsSync(ready) && a.output().includes(`${x.source.url} — refreshed:`)),
      );
      expect(a.done()).toBe(false);
      const newer = commit(x.repo, "newer cross-process bytes");
      const bCode = `import {indexAllSources} from "./src/catalog/index-source.ts"; indexAllSources([${JSON.stringify(x.source)}],{explicitPull:true}).then(outcomes=>{console.log("FIXTURE_B_RESULT="+JSON.stringify(outcomes));if(outcomes.some(o=>o.status==="failed"))process.exitCode=1}).catch(()=>{console.error("fixture refresh failed");process.exitCode=1});`;
      const b = productionChild(home, bCode);
      children.push(b);
      await fixtureHandshake(() => b.done() || b.output().includes(`Waiting for another refresh of ${x.source.url}`));
      writeFileSync(release, "release");
      const [aResult, bResult] = await Promise.all([fixtureChildResult(a), fixtureChildResult(b)]);
      expect(aResult.code).toBe(0);
      const aRecord = fixtureRecord<{ sources: Source[]; locked: { source: string; sha: string }[] }>(
        aResult,
        "FIXTURE_A_RESULT=",
      );
      const bRecord = fixtureRecord<{ status: string; reason: string; sha?: string }[]>(bResult, "FIXTURE_B_RESULT=");
      if (bResult.code !== 0) {
        expect(bResult.code).toBe(1);
        expect(bRecord.every((outcome) => outcome.sha === undefined)).toBe(true);
        expect(bRecord.some((outcome) => /busy|another.*refresh|lease/i.test(outcome.reason))).toBe(true);
        const retry = productionChild(home, bCode);
        children.push(retry);
        const retryResult = await fixtureChildResult(retry);
        expect(retryResult.code).toBe(0);
        expect(fixtureRecord<{ sha?: string }[]>(retryResult, "FIXTURE_B_RESULT=")[0]?.sha).toBe(newer);
      } else expect(bRecord[0]?.sha).toBe(newer);
      expect(git(childCache(x.source), "rev-parse", "HEAD")).toBe(newer);
      expect(aRecord.sources.find((source) => source.url === x.source.url)?.commitSha).toBe(accepted);
      expect(aRecord.locked.find((entry) => entry.source === x.source.url)?.sha).toBe(accepted);
      const installed = join(home, ".config", "agentbrew", "installed-skills", "fixture", "SKILL.md");
      expect(readFileSync(installed, "utf-8").trimEnd()).toBe(
        git(x.repo, "show", `${accepted}:skills/fixture/SKILL.md`),
      );
    } finally {
      writeFileSync(release, "release");
      await cleanupFixtureChildren(children);
    }
  }, 150_000);
});

describe("mixed source lease acquisition order (#780)", () => {
  it("keeps an existing filesystem owner progressing when an outside-context index waiter arrives first", async () => {
    const { source, cache } = fixture();
    const gate = gatedGit();
    let startWaiter: () => void = () => {};
    const trigger = new Promise<void>((ready) => {
      startWaiter = ready;
    });
    let waiterFinished = false;
    const waiter = trigger.then(() => indexAllSources([{ ...source }], { explicitPull: true }));
    waiter.then(
      () => {
        waiterFinished = true;
      },
      () => {
        waiterFinished = true;
      },
    );
    const owner = withSourceCheckoutLeases([{ path: cache, source: source.url }], async () => {
      startWaiter();
      await gate.flush();
      const indexing = indexAllSources([source], { explicitPull: true });
      try {
        await fixtureHandshake(() => gate.calls.length > 0 || waiterFinished);
        expect(waiterFinished).toBe(false);
        gate.release(gate.calls[0]!);
        await indexing;
      } finally {
        await gate.drain(Promise.allSettled([indexing]));
      }
    });
    try {
      await owner;
    } finally {
      startWaiter();
      await gate.drain(Promise.allSettled([owner, waiter]));
    }
    expect((await waiter)[0]?.sha).toBe(git(cache, "rev-parse", "HEAD"));
  });

  it("surfaces a typed busy refusal from the ordinary source-path API", async () => {
    const { source, cache } = fixture();
    let attempt: () => void = () => {};
    const trigger = new Promise<void>((ready) => {
      attempt = ready;
    });
    const reading = trigger.then(() => getSourceCachePath(source));
    await withSourceCheckoutLeases([{ path: cache }], async () => {
      attempt();
      await expect(reading).rejects.toBeInstanceOf(SourceCheckoutLeaseRefusal);
    });
  });
});
