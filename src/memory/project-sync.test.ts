import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemoryIngestOptions, MemoryIngestResult, MemoryMcpClient } from "./mcp-client.js";
import {
  checkProjectMemorySync,
  claudeProjectDirToSlug,
  discoverClaudeProjectMemoryStores,
  projectMemorySourceTag,
  resolveClaudeProjectsDir,
  syncClaudeProjectMemories,
} from "./project-sync.js";
import type { ProjectMemorySyncLedger } from "./project-sync-ledger.js";

const tempDirs: string[] = [];

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "agentbrew-project-memory-"));
  tempDirs.push(root);
  return root;
}

function writeStore(projectsDir: string, projectName: string, files: Record<string, string>): string {
  const store = join(projectsDir, projectName, "memory");
  mkdirSync(store, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(store, name), content, "utf-8");
  }
  return store;
}

function client(
  options: {
    initialize?: boolean;
    chunksStored?: number;
    ingestError?: boolean;
    ingest?: (options: MemoryIngestOptions) => Promise<MemoryIngestResult>;
  } = {},
): MemoryMcpClient {
  const ingest: (options: MemoryIngestOptions) => Promise<MemoryIngestResult> =
    options.ingest ??
    (async () => {
      if (options.ingestError) throw new Error("daemon unavailable");
      return { chunksStored: options.chunksStored ?? 0 };
    });
  return {
    initialize: vi.fn(async () => options.initialize ?? true),
    bootstrapProfileEnabled: vi.fn(async () => true),
    tagMatch: vi.fn(async () => []),
    memorySearch: vi.fn(async () => []),
    memoryIngest: ingest,
    memoryStore: vi.fn(async () => undefined),
    memoryUpdate: vi.fn(async () => undefined),
    memoryDelete: vi.fn(async () => true),
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Claude project-memory discovery", () => {
  it("keeps the historical Claude project slug convention", () => {
    expect(claudeProjectDirToSlug("-proj-alpha")).toBe("proj-alpha");
    expect(claudeProjectDirToSlug("-Users-alice-apps-example-app")).toBe("example-app");
    expect(claudeProjectDirToSlug("-")).toBe("unknown");
  });

  it("discovers populated direct markdown stores and skips empty or nested files", () => {
    const root = fixtureRoot();
    const projects = join(root, "projects");
    writeStore(projects, "-proj-alpha", { "fact.md": "alpha", "MEMORY.md": "index" });
    writeStore(projects, "-proj-empty", {});
    const nested = join(projects, "-proj-alpha", "memory", "nested");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "ignored.md"), "ignored", "utf-8");

    const stores = discoverClaudeProjectMemoryStores(projects);

    expect(stores).toHaveLength(1);
    expect(stores[0]).toMatchObject({ slug: "proj-alpha", fileCount: 2 });
    expect(stores[0]?.fingerprint).toMatch(/^sha256:/u);
    expect(stores[0]?.id).toMatch(/^sha256:/u);
  });

  it("honors AgentBrew and compatibility project-root environment names", () => {
    expect(resolveClaudeProjectsDir({ AGENTBREW_CLAUDE_PROJECTS_DIR: "/agentbrew" }, "/home/test")).toBe("/agentbrew");
    expect(resolveClaudeProjectsDir({ DOTFILES_CLAUDE_PROJECTS_DIR: "/dotfiles" }, "/home/test")).toBe("/dotfiles");
  });
});

describe("syncClaudeProjectMemories", () => {
  it("plans populated stores without contacting the daemon in dry-run mode", async () => {
    const root = fixtureRoot();
    const projects = join(root, "projects");
    writeStore(projects, "-proj-alpha", { "fact.md": "alpha" });
    const createClient = vi.fn();

    const result = await syncClaudeProjectMemories({ projectsDir: projects, dryRun: true, createClient });

    expect(result).toMatchObject({ stores: 1, synced: 1, skipped: 0, status: "ok" });
    expect(result.results).toEqual([{ slug: "proj-alpha", files: 1, status: "would-sync" }]);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("uses the managed client schema and records non-content sync evidence", async () => {
    const root = fixtureRoot();
    const projects = join(root, "projects");
    const store = writeStore(projects, "-proj-alpha", { "fact.md": "alpha fact" });
    const ingest = vi.fn<(options: MemoryIngestOptions) => Promise<MemoryIngestResult>>(async () => ({
      chunksStored: 4,
    }));
    const memoryClient = client({ ingest });
    let ledger: ProjectMemorySyncLedger | undefined;

    const result = await syncClaudeProjectMemories({
      projectsDir: projects,
      client: memoryClient,
      now: () => new Date("2026-09-24T12:00:00.000Z"),
      writeLedger: (next) => {
        ledger = next;
      },
    });

    expect(result).toMatchObject({ stores: 1, synced: 1, skipped: 0, status: "ok" });
    expect(ingest).toHaveBeenCalledWith({
      directoryPath: store,
      fileExtensions: ["md"],
      recursive: false,
      memoryType: "reference",
      chunkSize: 2_000,
      tags: ["claude-project-memory", expect.stringMatching(/^project-source:sha256:/u), "project:proj-alpha"],
    });
    expect(ledger).toMatchObject({
      version: 1,
      status: "ok",
      lastSuccessfulAt: "2026-09-24T12:00:00.000Z",
    });
    expect(JSON.stringify(ledger)).not.toContain(store);
    expect(JSON.stringify(ledger)).not.toContain("alpha fact");
  });

  it("skips unchanged stores without contacting the daemon and force re-ingests them", async () => {
    const root = fixtureRoot();
    const projects = join(root, "projects");
    writeStore(projects, "-proj-alpha", { "fact.md": "alpha" });
    writeStore(projects, "-proj-beta", { "fact.md": "beta" });
    let ledger: ProjectMemorySyncLedger | undefined;

    await syncClaudeProjectMemories({
      projectsDir: projects,
      client: client(),
      writeLedger: (next) => {
        ledger = next;
      },
    });

    const unchangedIngest = vi.fn<(options: MemoryIngestOptions) => Promise<MemoryIngestResult>>(async () => ({
      chunksStored: 0,
    }));
    const unchanged = await syncClaudeProjectMemories({
      projectsDir: projects,
      ledger,
      client: client({ ingest: unchangedIngest }),
      writeLedger: () => undefined,
    });

    expect(unchanged).toMatchObject({ stores: 2, synced: 0, skipped: 0, unchanged: 2, status: "ok" });
    expect(unchanged.results.map((result) => result.status)).toEqual(["unchanged", "unchanged"]);
    expect(unchangedIngest).not.toHaveBeenCalled();

    const forceIngest = vi.fn<(options: MemoryIngestOptions) => Promise<MemoryIngestResult>>(async () => ({
      chunksStored: 0,
    }));
    const forced = await syncClaudeProjectMemories({
      projectsDir: projects,
      ledger,
      force: true,
      client: client({ ingest: forceIngest }),
      writeLedger: () => undefined,
    });

    expect(forced).toMatchObject({ stores: 2, synced: 2, skipped: 0, unchanged: 0, status: "ok" });
    expect(forceIngest).toHaveBeenCalledTimes(2);
  });

  it("uses distinct hashed provenance tags when readable project labels collide", async () => {
    const root = fixtureRoot();
    const projects = join(root, "projects");
    const aliceStore = writeStore(projects, "-Users-alice-apps-shared", { "fact.md": "alice fact" });
    const bobStore = writeStore(projects, "-Users-bob-apps-shared", { "fact.md": "bob fact" });
    const ingested: MemoryIngestOptions[] = [];
    let ledger: ProjectMemorySyncLedger | undefined;

    await syncClaudeProjectMemories({
      projectsDir: projects,
      client: client({
        ingest: async (options) => {
          ingested.push(options);
          return { chunksStored: 1 };
        },
      }),
      writeLedger: (next) => {
        ledger = next;
      },
    });

    const sourceTags = ingested.map((options) => options.tags.find((tag) => tag.startsWith("project-source:")));
    expect(ingested.map((options) => options.tags.at(-1))).toEqual(["project:shared", "project:shared"]);
    expect(sourceTags[0]).toMatch(/^project-source:sha256:/u);
    expect(sourceTags[1]).toMatch(/^project-source:sha256:/u);
    expect(sourceTags[0]).not.toBe(sourceTags[1]);
    expect(projectMemorySourceTag(discoverClaudeProjectMemoryStores(projects)[0]!)).toBe(sourceTags[0]);

    const evidence = JSON.stringify({ ledger, tags: ingested.map((options) => options.tags) });
    expect(evidence).not.toContain(aliceStore);
    expect(evidence).not.toContain(bobStore);
    expect(evidence).not.toContain("alice fact");
    expect(evidence).not.toContain("bob fact");
  });

  it("degrades without throwing when the daemon is unavailable", async () => {
    const root = fixtureRoot();
    const projects = join(root, "projects");
    writeStore(projects, "-proj-alpha", { "fact.md": "alpha" });
    let ledger: ProjectMemorySyncLedger | undefined;

    const result = await syncClaudeProjectMemories({
      projectsDir: projects,
      client: client({ initialize: false }),
      now: () => new Date("2026-09-24T12:00:00.000Z"),
      writeLedger: (next) => {
        ledger = next;
      },
    });

    expect(result).toMatchObject({ stores: 1, synced: 0, skipped: 1, status: "degraded" });
    expect(result.results[0]).toMatchObject({ status: "skipped", detail: "daemon-unavailable" });
    expect(ledger).toMatchObject({ status: "degraded" });
  });

  it("does not make a successful ingestion fail when sync evidence cannot be written", async () => {
    const root = fixtureRoot();
    const projects = join(root, "projects");
    writeStore(projects, "-proj-alpha", { "fact.md": "alpha" });

    await expect(
      syncClaudeProjectMemories({
        projectsDir: projects,
        client: client(),
        writeLedger: () => {
          throw new Error("read-only state directory");
        },
      }),
    ).resolves.toMatchObject({ status: "ok", synced: 1 });
  });

  it("retains partial success evidence and leaves failed stores eligible for retry", async () => {
    const root = fixtureRoot();
    const projects = join(root, "projects");
    const alphaStore = writeStore(projects, "-proj-alpha", { "fact.md": "alpha" });
    const betaStore = writeStore(projects, "-proj-beta", { "fact.md": "beta" });
    let ledger: ProjectMemorySyncLedger | undefined;

    await syncClaudeProjectMemories({
      projectsDir: projects,
      client: client(),
      now: () => new Date("2026-09-24T12:00:00.000Z"),
      writeLedger: (next) => {
        ledger = next;
      },
    });
    const previous = ledger!;
    writeFileSync(join(alphaStore, "fact.md"), "changed alpha", "utf-8");
    writeFileSync(join(betaStore, "fact.md"), "changed beta", "utf-8");

    let call = 0;
    await syncClaudeProjectMemories({
      projectsDir: projects,
      ledger: previous,
      now: () => new Date("2026-09-24T13:00:00.000Z"),
      client: client({
        ingest: async () => {
          call += 1;
          if (call === 2) throw new Error("daemon unavailable");
          return { chunksStored: 1 };
        },
      }),
      writeLedger: (next) => {
        ledger = next;
      },
    });

    expect(ledger).toMatchObject({
      status: "degraded",
      lastSuccessfulAt: "2026-09-24T12:00:00.000Z",
    });
    expect(checkProjectMemorySync({ projectsDir: projects, ledger })).toMatchObject({ status: "drifted", stale: 1 });
  });

  it("marks changed or failed project stores as drifted without reading memory content", async () => {
    const root = fixtureRoot();
    const projects = join(root, "projects");
    const store = writeStore(projects, "-proj-alpha", { "fact.md": "alpha" });
    let ledger: ProjectMemorySyncLedger | undefined;

    await syncClaudeProjectMemories({
      projectsDir: projects,
      client: client(),
      now: () => new Date("2026-09-24T12:00:00.000Z"),
      writeLedger: (next) => {
        ledger = next;
      },
    });
    expect(ledger).toBeDefined();
    expect(checkProjectMemorySync({ projectsDir: projects, ledger })).toMatchObject({ status: "ok", stale: 0 });

    writeFileSync(join(store, "fact.md"), "changed alpha fact", "utf-8");
    expect(checkProjectMemorySync({ projectsDir: projects, ledger })).toMatchObject({ status: "drifted", stale: 1 });
  });

  it("does not mark unchanged stores stale after a later degraded attempt", async () => {
    const root = fixtureRoot();
    const projects = join(root, "projects");
    writeStore(projects, "-proj-alpha", { "fact.md": "alpha" });
    let ledger: ProjectMemorySyncLedger | undefined;

    await syncClaudeProjectMemories({
      projectsDir: projects,
      client: client(),
      writeLedger: (next) => {
        ledger = next;
      },
    });

    expect(ledger).toBeDefined();
    expect(
      checkProjectMemorySync({
        projectsDir: projects,
        ledger: { ...ledger!, status: "degraded" },
      }),
    ).toMatchObject({ status: "ok", stale: 0 });
  });

  it("uses force as the same metadata-only selection rule for sync checks", () => {
    const root = fixtureRoot();
    const projects = join(root, "projects");
    writeStore(projects, "-proj-alpha", { "fact.md": "alpha" });

    expect(checkProjectMemorySync({ projectsDir: projects, force: true })).toMatchObject({
      stores: 1,
      stale: 1,
      status: "drifted",
    });
  });
});
