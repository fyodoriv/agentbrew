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
  versioned?: boolean;
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
    const ledgerState = ledger?.records[record.key];
    const remote = existingByKey.get(record.key);
    if (!remote && ledgerState) throw new Error(`cannot verify memory for ${record.key}`);

    if (!remote) {
      actions.push({ key: record.key, action: "store" });
      continue;
    }

    const remoteTags = filterSupersededTags(remote.tags);
    const sameBody = remote.content === record.content;
    const comparable = (values: string[]) =>
      values
        .filter((tag) => sameBody || !tag.startsWith("pack:version:"))
        .sort()
        .join("|");
    if (comparable(remoteTags) !== comparable(tags)) {
      throw new Error(`cannot safely replace tags for ${record.key}`);
    }

    if (sameBody) {
      actions.push({ key: record.key, action: "noop", memoryId: remote.id });
      continue;
    }

    actions.push({
      key: record.key,
      action: "update",
      memoryId: remote.id,
      versioned: remote.content !== record.content,
    });
  }
  return actions;
}

function selectExistingPackRow(
  key: string,
  candidates: Array<{ id: string; content: string; tags: string[] }>,
  pack: ParsedMemoryPack,
  ledger?: PackInstallLedger,
): { id: string; content: string; tags: string[] } {
  const ledgerId = ledger?.records[key]?.memoryId;
  const record = pack.records.find((item) => item.key === key);
  const desiredTags = record ? recordTags(pack, record).sort().join("|") : "";
  const desired =
    ledgerId && record
      ? candidates.filter((row) => row.content === record.content && [...row.tags].sort().join("|") === desiredTags)
      : [];
  const matching =
    desired.length > 0 ? desired : ledgerId ? candidates.filter((row) => row.id === ledgerId) : candidates;
  if (matching.length !== 1) throw new Error(`cannot verify memory for ${key}`);
  return matching[0];
}

function indexExistingByRecordTag(
  rows: Array<{ id: string; content: string; tags: string[] }>,
  pack: ParsedMemoryPack,
  ledger?: PackInstallLedger,
): Map<string, { id: string; content: string; tags: string[] }> {
  const grouped = new Map<string, Array<{ id: string; content: string; tags: string[] }>>();
  for (const row of rows) {
    const tags = filterSupersededTags(row.tags);
    const recordTag = tags.find((tag) => tag.startsWith("pack:record:"));
    if (!recordTag || !tags.includes(`pack:id:${pack.manifest.id}`)) continue;
    const key = recordTag.slice("pack:record:".length);
    grouped.set(key, [...(grouped.get(key) ?? []), { ...row, tags }]);
  }
  const selected = new Map<string, { id: string; content: string; tags: string[] }>();
  for (const [key, candidates] of grouped) {
    selected.set(key, selectExistingPackRow(key, candidates, pack, ledger));
  }
  return selected;
}

async function verifyMissingLedgerRows(
  client: MemoryMcpClient,
  pack: ParsedMemoryPack,
  ledger: PackInstallLedger | undefined,
  existing: Map<string, { id: string; content: string; tags: string[] }>,
): Promise<void> {
  if (!ledger) return;
  for (const record of pack.records) {
    const prior = ledger.records[record.key];
    if (!prior || existing.has(record.key)) continue;
    const rows = await client.memorySearch(record.content, "exact");
    const matches = rows.filter((row) => row.id === prior.memoryId && row.content === record.content);
    if (matches.length !== 1) throw new Error(`cannot verify memory for ${record.key}`);
    existing.set(record.key, matches[0]);
  }
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
    // Content changes require upstream versioning; metadata-only repairs keep the ID.
    const memoryId = await client.memoryUpdate(action.memoryId, record.content, tags, { versioned: action.versioned });
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
  const existingByKey = indexExistingByRecordTag(existingRows, pack, ledger);
  await verifyMissingLedgerRows(client, pack, ledger, existingByKey);
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
