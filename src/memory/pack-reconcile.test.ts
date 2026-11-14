import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ledgers = new Map<string, unknown>();

vi.mock("./pack-ledger.js", () => ({
  readPackLedger: vi.fn((packId: string) => ledgers.get(packId)),
  writePackLedger: vi.fn((ledger: { packId: string }) => {
    ledgers.set(ledger.packId, ledger);
  }),
  deletePackLedger: vi.fn((packId: string) => ledgers.delete(packId)),
  listInstalledPackLedgers: vi.fn(() => [...ledgers.values()]),
}));

import { createFetchMemoryMcpClient, type MemoryMcpClient } from "./mcp-client.js";
import { loadMemoryPackFromDir } from "./pack-contract.js";
import { contentFingerprint, planPackReconcile, reconcileInstalledPack, recordTags } from "./pack-reconcile.js";

const fixtureDir = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures/example-pack");

beforeEach(() => {
  ledgers.clear();
  vi.clearAllMocks();
});

function mockClient(rows: Array<{ id: string; content: string; tags: string[] }> = []): MemoryMcpClient {
  const store = new Map(rows.map((r) => [r.id, r]));
  return {
    initialize: vi.fn(async () => true),
    bootstrapProfileEnabled: vi.fn(async () => true),
    tagMatch: vi.fn(async () => [...store.values()]),
    memorySearch: vi.fn(async () => []),
    memoryIngest: vi.fn(async () => ({ chunksStored: 0 })),
    memoryStore: vi.fn(async (content, tags) => {
      const id = `mem-${store.size + 1}`;
      store.set(id, { id, content, tags });
      return id;
    }),
    memoryUpdate: vi.fn(async (id, content, tags, options) => {
      if (options?.versioned === true) {
        store.set(`${id}-version`, { id: `${id}-version`, content, tags });
        return `${id}-version`;
      }
      store.set(id, { id, content, tags });
      return id;
    }),
    memoryDelete: vi.fn(async (id) => {
      store.delete(id);
      return true;
    }),
  };
}

describe("pack reconciliation duplicate handling", () => {
  it("does not advance the ledger or update an existing memory on a duplicate response", async () => {
    const client = createFetchMemoryMcpClient({
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { content: [{ type: "text", text: "Duplicate content detected (exact match)" }] },
          }),
          { status: 200 },
        ),
    });
    vi.spyOn(client, "tagMatch").mockResolvedValue([]);
    const update = vi.spyOn(client, "memoryUpdate");
    await expect(reconcileInstalledPack(client, fixtureDir)).rejects.toThrow("memory_store failed");
    expect(ledgers.size).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });
  it("does not advance an existing ledger when an update response reports failure", async () => {
    const pack = loadMemoryPackFromDir(fixtureDir);
    const record = pack.records[0];
    const ledger = {
      packId: pack.manifest.id,
      version: pack.manifest.version,
      fingerprint: pack.manifest.fingerprint,
      packPath: fixtureDir,
      installedAt: "2026-01-01T00:00:00.000Z",
      records: {
        [record.key]: {
          memoryId: "mem-existing",
          revision: record.revision,
          sourceFingerprint: record.sourceFingerprint,
          contentFingerprint: "sha256:stale",
        },
      },
    };
    ledgers.set(pack.manifest.id, ledger);
    const client = createFetchMemoryMcpClient({
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { content: [{ type: "text", text: "Failed to update memory metadata: synthetic error" }] },
          }),
          { status: 200 },
        ),
    });
    vi.spyOn(client, "tagMatch").mockResolvedValue([
      { id: "mem-existing", content: "older synthetic content", tags: recordTags(pack, record) },
    ]);
    await expect(reconcileInstalledPack(client, fixtureDir, { ledger })).rejects.toThrow("memory_update failed");
    expect(ledgers.get(pack.manifest.id)).toEqual(ledger);
  });
});

describe("pack reconciliation planning", () => {
  it("plans store for missing records", () => {
    const pack = loadMemoryPackFromDir(fixtureDir);
    const actions = planPackReconcile(pack, new Map());
    expect(actions.every((a) => a.action === "store")).toBe(true);
    expect(actions).toHaveLength(pack.records.length);
  });

  it("fails closed when a version bump leaves one record unchanged", () => {
    const pack = loadMemoryPackFromDir(fixtureDir);
    const first = pack.records[0];
    const second = pack.records[1];
    const existing = new Map([
      [first.key, { id: "first", content: "older content", tags: recordTags(pack, first) }],
      [second.key, { id: "second", content: second.content, tags: recordTags(pack, second) }],
    ]);
    pack.manifest.version = "2.0.0";
    expect(() => planPackReconcile(pack, existing)).toThrow("cannot safely replace tags");
  });

  it("plans a versioned content update when only the managed pack version tag changes", () => {
    const pack = loadMemoryPackFromDir(fixtureDir);
    const record = pack.records[0];
    const oldTags = recordTags(pack, record);
    pack.manifest.version = "2.0.0";
    const existing = new Map([[record.key, { id: "old", content: "older content", tags: oldTags }]]);
    const action = planPackReconcile(pack, existing).find((item) => item.key === record.key);
    expect(action).toMatchObject({ action: "update", memoryId: "old", versioned: true });
  });

  it("plans noop when body tags and ledger match", () => {
    const pack = loadMemoryPackFromDir(fixtureDir);
    const record = pack.records[0];
    const tags = recordTags(pack, record);
    const fp = contentFingerprint(record.content, tags);
    const existing = new Map([
      [
        record.key,
        {
          id: "mem-1",
          content: record.content,
          tags,
        },
      ],
    ]);
    const actions = planPackReconcile(pack, existing, {
      packId: pack.manifest.id,
      version: pack.manifest.version,
      fingerprint: pack.manifest.fingerprint,
      packPath: fixtureDir,
      installedAt: new Date().toISOString(),
      records: {
        [record.key]: {
          memoryId: "mem-1",
          revision: record.revision,
          sourceFingerprint: record.sourceFingerprint,
          contentFingerprint: fp,
        },
      },
    });
    const first = actions.find((a) => a.key === record.key);
    expect(first?.action).toBe("noop");
  });
});

describe("reconcileInstalledPack", () => {
  it("stores all records on first install", async () => {
    const client = mockClient();
    const result = await reconcileInstalledPack(client, fixtureDir);
    expect(result.applied).toBe(true);
    expect(result.actions.filter((a) => a.action === "store")).toHaveLength(2);
    expect(client.memoryStore).toHaveBeenCalledTimes(2);
  });

  it("dry-run does not call memory_store", async () => {
    const client = mockClient();
    const result = await reconcileInstalledPack(client, fixtureDir, { dryRun: true });
    expect(result.applied).toBe(false);
    expect(client.memoryStore).not.toHaveBeenCalled();
  });

  it("uses a versioned update for changed content and records the new ID", async () => {
    const pack = loadMemoryPackFromDir(fixtureDir);
    const record = pack.records[0];
    const client = mockClient([{ id: "mem-old", content: "stale synthetic text", tags: recordTags(pack, record) }]);
    const result = await reconcileInstalledPack(client, fixtureDir);
    expect(client.memoryUpdate).toHaveBeenCalledWith("mem-old", record.content, expect.any(Array), { versioned: true });
    const stored = ledgers.get(pack.manifest.id) as { records: Record<string, { memoryId: string }> };
    expect(stored.records[record.key].memoryId).toBe("mem-old-version");
    expect(result.applied).toBe(true);
  });

  it("does not mutate a ledger-only record whose content cannot be verified", async () => {
    const pack = loadMemoryPackFromDir(fixtureDir);
    const record = pack.records[0];
    const client = mockClient();
    const ledger = {
      packId: pack.manifest.id,
      version: pack.manifest.version,
      fingerprint: pack.manifest.fingerprint,
      packPath: fixtureDir,
      installedAt: "2026-01-01T00:00:00.000Z",
      records: {
        [record.key]: {
          memoryId: "mem-old",
          revision: record.revision,
          sourceFingerprint: record.sourceFingerprint,
          contentFingerprint: "sha256:stale",
        },
      },
    };
    await expect(reconcileInstalledPack(client, fixtureDir, { ledger })).rejects.toThrow("cannot verify");
    expect(client.memoryUpdate).not.toHaveBeenCalled();
  });

  it("does not replace tags after verifying a ledger-only record", async () => {
    const pack = loadMemoryPackFromDir(fixtureDir);
    const record = pack.records[0];
    const client = mockClient();
    const ledger = {
      packId: pack.manifest.id,
      version: pack.manifest.version,
      fingerprint: pack.manifest.fingerprint,
      packPath: fixtureDir,
      installedAt: "2026-01-01T00:00:00.000Z",
      records: {
        [record.key]: {
          memoryId: "mem-old",
          revision: record.revision,
          sourceFingerprint: record.sourceFingerprint,
          contentFingerprint: "sha256:stale",
        },
      },
    };
    vi.mocked(client.memorySearch).mockResolvedValue([{ id: "mem-old", content: record.content, tags: [] }]);
    await expect(reconcileInstalledPack(client, fixtureDir, { ledger })).rejects.toThrow("cannot safely replace tags");
    expect(client.memoryUpdate).not.toHaveBeenCalled();
  });

  it.each([false, true])("selects the ledger version regardless of row order (reverse=%s)", async (reverse) => {
    const pack = loadMemoryPackFromDir(fixtureDir);
    const record = pack.records[0];
    const tags = recordTags(pack, record);
    const rows = [
      { id: "old", content: "older content", tags },
      { id: "current", content: record.content, tags },
    ];
    const client = mockClient(reverse ? rows.reverse() : rows);
    const ledger = {
      packId: pack.manifest.id,
      version: pack.manifest.version,
      fingerprint: pack.manifest.fingerprint,
      packPath: fixtureDir,
      installedAt: "2026-01-01T00:00:00.000Z",
      records: {
        [record.key]: {
          memoryId: "current",
          revision: record.revision,
          sourceFingerprint: record.sourceFingerprint,
          contentFingerprint: contentFingerprint(record.content, tags),
        },
      },
    };
    const result = await reconcileInstalledPack(client, fixtureDir, { ledger });
    expect(result.actions.find((action) => action.key === record.key)).toMatchObject({
      action: "noop",
      memoryId: "current",
    });
    expect(client.memoryUpdate).not.toHaveBeenCalled();
  });

  it.each([false, true])("adopts the matching version after an interrupted update (reverse=%s)", async (reverse) => {
    const pack = loadMemoryPackFromDir(fixtureDir);
    const record = pack.records[0];
    const tags = recordTags(pack, record);
    const rows = [
      { id: "old", content: "older content", tags },
      { id: "current", content: record.content, tags },
    ];
    const client = mockClient(reverse ? rows.reverse() : rows);
    const ledger = {
      packId: pack.manifest.id,
      version: pack.manifest.version,
      fingerprint: pack.manifest.fingerprint,
      packPath: fixtureDir,
      installedAt: "2026-01-01T00:00:00.000Z",
      records: {
        [record.key]: {
          memoryId: "old",
          revision: record.revision,
          sourceFingerprint: "sha256:old",
          contentFingerprint: "sha256:old",
        },
      },
    };
    const result = await reconcileInstalledPack(client, fixtureDir, { ledger });
    expect(result.actions.find((action) => action.key === record.key)).toMatchObject({
      action: "noop",
      memoryId: "current",
    });
    expect(client.memoryUpdate).not.toHaveBeenCalled();
    const saved = ledgers.get(pack.manifest.id) as { records: Record<string, { memoryId: string }> };
    expect(saved.records[record.key].memoryId).toBe("current");
  });

  it("does not guess between multiple tagged versions without a ledger", async () => {
    const pack = loadMemoryPackFromDir(fixtureDir);
    const record = pack.records[0];
    const tags = recordTags(pack, record);
    const client = mockClient([
      { id: "old", content: "older content", tags },
      { id: "current", content: record.content, tags },
    ]);
    await expect(reconcileInstalledPack(client, fixtureDir)).rejects.toThrow("cannot verify");
    expect(client.memoryUpdate).not.toHaveBeenCalled();
  });

  it("does not replace incomplete tags on an existing pack record", async () => {
    const pack = loadMemoryPackFromDir(fixtureDir);
    const record = pack.records[0];
    const client = mockClient([
      {
        id: "mem-existing",
        content: record.content,
        tags: [`pack:id:${pack.manifest.id}`, `pack:record:${record.key}`],
      },
    ]);
    const ledger = {
      packId: pack.manifest.id,
      version: pack.manifest.version,
      fingerprint: pack.manifest.fingerprint,
      packPath: fixtureDir,
      installedAt: "2026-01-01T00:00:00.000Z",
      records: {
        [record.key]: {
          memoryId: "mem-existing",
          revision: record.revision,
          sourceFingerprint: record.sourceFingerprint,
          contentFingerprint: "sha256:stale",
        },
      },
    };

    await expect(reconcileInstalledPack(client, fixtureDir, { ledger })).rejects.toThrow("cannot safely replace tags");
    expect(client.memoryUpdate).not.toHaveBeenCalled();
  });
});
