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

import type { MemoryMcpClient } from "./mcp-client.js";
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
      } else {
        store.set(id, { id, content, tags });
      }
      return id;
    }),
    memoryDelete: vi.fn(async (id) => {
      store.delete(id);
      return true;
    }),
  };
}

describe("pack reconciliation planning", () => {
  it("plans store for missing records", () => {
    const pack = loadMemoryPackFromDir(fixtureDir);
    const actions = planPackReconcile(pack, new Map());
    expect(actions.every((a) => a.action === "store")).toBe(true);
    expect(actions).toHaveLength(pack.records.length);
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

  it("updates existing pack records in place while repairing tags", async () => {
    const pack = loadMemoryPackFromDir(fixtureDir);
    const record = pack.records[0];
    const client = mockClient([{ id: "mem-existing", content: record.content, tags: record.tags }]);
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

    const result = await reconcileInstalledPack(client, fixtureDir, { ledger });

    expect(result.actions.find((action) => action.key === record.key)?.action).toBe("update");
    expect(client.memoryUpdate).toHaveBeenCalledWith(
      "mem-existing",
      record.content,
      expect.arrayContaining([`pack:id:${pack.manifest.id}`]),
      { versioned: false },
    );
  });
});
