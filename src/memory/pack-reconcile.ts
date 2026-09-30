import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { MemoryMcpClient } from "./mcp-client.js";
import {
  filterSupersededTags,
  loadMemoryPackFromDir,
  type MemoryPackRecord,
  type ParsedMemoryPack,
  packTagsForRecord,
} from "./pack-contract.js";
import {
  deletePackLedger,
  listInstalledPackLedgers,
  type PackInstallLedger,
  type PackLedgerRecordState,
  readPackLedger,
  writePackLedger,
} from "./pack-ledger.js";

export interface DiscoveredPack {
  id: string;
  path: string;
  title: string;
  version: string;
  privacy: string;
  installed: boolean;
}

export interface PackReconcileAction {
  key: string;
  action: "store" | "update" | "noop" | "delete";
  memoryId?: string;
}

export interface PackReconcileResult {
  packId: string;
  actions: PackReconcileAction[];
  applied: boolean;
}

export function contentFingerprint(content: string, tags: string[]): string {
  const hash = createHash("sha256")
    .update(JSON.stringify({ content, tags: [...tags].sort() }))
    .digest("hex");
  return `sha256:${hash}`;
}

export function recordTags(pack: ParsedMemoryPack, record: MemoryPackRecord): string[] {
  return [...new Set([...record.tags, ...packTagsForRecord(pack.manifest.id, pack.manifest.version, record.key)])];
}

export function planPackReconcile(
  pack: ParsedMemoryPack,
  existingByKey: Map<string, { id: string; content: string; tags: string[] }>,
  ledger?: PackInstallLedger,
): PackReconcileAction[] {
  const actions: PackReconcileAction[] = [];
  for (const record of pack.records) {
    const tags = recordTags(pack, record);
    const fp = contentFingerprint(record.content, tags);
    const ledgerState = ledger?.records[record.key];
    // The ledger is the recovery path when an older client or manual edit
    // removed pack tags. Trust its stable memory ID and repair the row in
    // place instead of storing a duplicate pack record.
    const remote =
      existingByKey.get(record.key) ?? (ledgerState ? { id: ledgerState.memoryId, content: "", tags: [] } : undefined);

    if (!remote) {
      actions.push({ key: record.key, action: "store" });
      continue;
    }

    const remoteTags = filterSupersededTags(remote.tags);
    const remoteFp = contentFingerprint(remote.content, remoteTags);
    const sameBody =
      remote.content === record.content &&
      remoteFp === fp &&
      remoteTags.sort().join("|") === tags.sort().join("|") &&
      ledgerState?.sourceFingerprint === record.sourceFingerprint;

    if (sameBody && ledgerState?.memoryId === remote.id) {
      actions.push({ key: record.key, action: "noop", memoryId: remote.id });
      continue;
    }

    actions.push({ key: record.key, action: "update", memoryId: remote.id });
  }
  return actions;
}

function indexExistingByRecordTag(
  rows: Array<{ id: string; content: string; tags: string[] }>,
  packId: string,
): Map<string, { id: string; content: string; tags: string[] }> {
  const map = new Map<string, { id: string; content: string; tags: string[] }>();
  for (const row of rows) {
    const tags = filterSupersededTags(row.tags);
    const recordTag = tags.find((t) => t.startsWith("pack:record:"));
    const idTag = tags.find((t) => t === `pack:id:${packId}`);
    if (!recordTag || !idTag) continue;
    const key = recordTag.slice("pack:record:".length);
    map.set(key, { id: row.id, content: row.content, tags });
  }
  return map;
}

function buildPackLedgerRecord(
  memoryId: string,
  record: MemoryPackRecord,
  contentFingerprint: string,
): PackLedgerRecordState {
  return {
    memoryId,
    revision: record.revision,
    sourceFingerprint: record.sourceFingerprint,
    contentFingerprint,
  };
}

async function applyPackRecordAction(
  client: MemoryMcpClient,
  record: MemoryPackRecord,
  action: PackReconcileAction,
  tags: string[],
  fingerprint: string,
): Promise<PackLedgerRecordState | undefined> {
  if (action.action === "store") {
    const memoryId = await client.memoryStore(record.content, tags, record.conversationId);
    if (!memoryId) throw new Error(`memory_store failed for ${record.key}`);
    return buildPackLedgerRecord(memoryId, record, fingerprint);
  }
  if (action.action === "update" && action.memoryId) {
    // Pack reconciliation repairs pack metadata in place so an existing local
    // memory keeps its identity and is not hidden behind a superseded row.
    const memoryId = await client.memoryUpdate(action.memoryId, record.content, tags, { versioned: false });
    if (!memoryId) throw new Error(`memory_update failed for ${record.key}`);
    return buildPackLedgerRecord(memoryId, record, fingerprint);
  }
  if (action.action === "noop" && action.memoryId) {
    return buildPackLedgerRecord(action.memoryId, record, fingerprint);
  }
  return undefined;
}

export async function fetchPackExistingRows(
  client: MemoryMcpClient,
  packId: string,
): Promise<Array<{ id: string; content: string; tags: string[] }>> {
  const rows = await client.tagMatch([`pack:id:${packId}`], true);
  return rows.map((row) => ({ id: row.id, content: row.content, tags: row.tags }));
}

async function applyPackRecordActions(
  client: MemoryMcpClient,
  pack: ParsedMemoryPack,
  actions: PackReconcileAction[],
  ledger: PackInstallLedger | undefined,
): Promise<Record<string, PackLedgerRecordState>> {
  const nextRecords: Record<string, PackLedgerRecordState> = { ...(ledger?.records ?? {}) };
  for (const record of pack.records) {
    const action = actions.find((a) => a.key === record.key);
    if (!action) continue;
    const tags = recordTags(pack, record);
    const fp = contentFingerprint(record.content, tags);
    const nextState = await applyPackRecordAction(client, record, action, tags, fp);
    if (nextState) nextRecords[record.key] = nextState;
  }
  return nextRecords;
}

export async function reconcileInstalledPack(
  client: MemoryMcpClient,
  packDir: string,
  options: { dryRun?: boolean; ledger?: PackInstallLedger } = {},
): Promise<PackReconcileResult> {
  const pack = loadMemoryPackFromDir(packDir);
  const ledger = options.ledger ?? readPackLedger(pack.manifest.id);
  const existingRows = await fetchPackExistingRows(client, pack.manifest.id);
  const existingByKey = indexExistingByRecordTag(existingRows, pack.manifest.id);
  const actions = planPackReconcile(pack, existingByKey, ledger);

  if (options.dryRun) {
    return { packId: pack.manifest.id, actions, applied: false };
  }

  const nextRecords = await applyPackRecordActions(client, pack, actions, ledger);

  writePackLedger({
    packId: pack.manifest.id,
    version: pack.manifest.version,
    fingerprint: pack.manifest.fingerprint,
    packPath: pack.rootDir,
    installedAt: ledger?.installedAt ?? new Date().toISOString(),
    records: nextRecords,
  });

  return { packId: pack.manifest.id, actions, applied: true };
}

export async function reconcileAllInstalledPacks(client: MemoryMcpClient): Promise<PackReconcileResult[]> {
  const results: PackReconcileResult[] = [];
  for (const ledger of listInstalledPackLedgers()) {
    if (!existsSync(ledger.packPath)) continue;
    results.push(await reconcileInstalledPack(client, ledger.packPath, { ledger }));
  }
  return results;
}

export function discoverPacks(searchPaths: string[]): DiscoveredPack[] {
  const discovered: DiscoveredPack[] = [];
  const seen = new Set<string>();
  for (const rawPath of searchPaths) {
    const dir = resolve(rawPath);
    const manifestPath = join(dir, "pack.yaml");
    if (!existsSync(manifestPath)) continue;
    try {
      const pack = loadMemoryPackFromDir(dir);
      if (seen.has(pack.manifest.id)) continue;
      seen.add(pack.manifest.id);
      discovered.push({
        id: pack.manifest.id,
        path: dir,
        title: pack.manifest.title,
        version: pack.manifest.version,
        privacy: pack.manifest.privacy,
        installed: readPackLedger(pack.manifest.id) !== undefined,
      });
    } catch {
      // skip invalid pack dirs
    }
  }
  return discovered;
}

export async function uninstallPack(
  client: MemoryMcpClient,
  packId: string,
  options: { confirm?: boolean; dryRun?: boolean } = {},
): Promise<{ deleted: number; dryRun: boolean }> {
  const ledger = readPackLedger(packId);
  if (!ledger) return { deleted: 0, dryRun: !!options.dryRun };

  const rows = await fetchPackExistingRows(client, packId);
  const toDelete = rows.filter((row) => {
    const tags = filterSupersededTags(row.tags);
    return tags.includes(`pack:id:${packId}`) && tags.some((t) => t.startsWith("pack:record:"));
  });

  if (options.dryRun || !options.confirm) {
    return { deleted: toDelete.length, dryRun: true };
  }

  let deleted = 0;
  for (const row of toDelete) {
    const ok = await client.memoryDelete(row.id);
    if (ok) deleted++;
  }
  deletePackLedger(packId);
  return { deleted, dryRun: false };
}

export function resolvePackDir(packId: string, searchPaths: string[]): string | undefined {
  return discoverPacks(searchPaths).find((p) => p.id === packId)?.path;
}
