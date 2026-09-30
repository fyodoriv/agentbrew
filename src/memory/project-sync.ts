import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { MEMORY_MCP_URL } from "./constants.js";
import { createFetchMemoryMcpClient, type MemoryIngestOptions, type MemoryMcpClient } from "./mcp-client.js";
import {
  type ProjectMemorySyncLedger,
  type ProjectMemorySyncStatus,
  readProjectMemorySyncLedger,
  writeProjectMemorySyncLedger,
} from "./project-sync-ledger.js";

const PROJECT_MEMORY_TAG = "claude-project-memory";
const PROJECT_MEMORY_SOURCE_TAG_PREFIX = "project-source:";
const DEFAULT_SYNC_TIMEOUT_MS = 120_000;

export interface ClaudeProjectMemoryStore {
  directory: string;
  id: string;
  slug: string;
  fileCount: number;
  fingerprint: string;
}

export type ProjectMemorySyncStoreStatus = "synced" | "skipped" | "unchanged" | "would-sync";

export interface ProjectMemorySyncStoreResult {
  slug: string;
  files: number;
  status: ProjectMemorySyncStoreStatus;
  chunksStored?: number;
  detail?: "daemon-unavailable";
}

export interface ProjectMemorySyncResult {
  stores: number;
  synced: number;
  skipped: number;
  unchanged: number;
  status: ProjectMemorySyncStatus;
  results: ProjectMemorySyncStoreResult[];
}

export interface ProjectMemorySyncCheck {
  stores: number;
  stale: number;
  status: "none" | "ok" | "drifted";
  lastSuccessfulAt?: string;
}

export interface ProjectMemorySyncOptions {
  projectsDir?: string;
  dryRun?: boolean;
  /** Re-ingest every discovered store, bypassing metadata delta detection. */
  force?: boolean;
  client?: MemoryMcpClient;
  createClient?: (options: { url: string; timeoutMs: number }) => MemoryMcpClient;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
  ledger?: ProjectMemorySyncLedger;
  writeLedger?: (ledger: ProjectMemorySyncLedger) => void;
}

export function claudeProjectDirToSlug(raw: string): string {
  let slug = raw.replace(/^-/, "");
  if (slug.startsWith("Users-")) {
    slug = slug.slice("Users-".length);
    slug = slug.replace(/^[^-]+-/, "").replace(/^apps-/, "");
  }
  return slug || "unknown";
}

function fingerprint(parts: string[]): string {
  return `sha256:${createHash("sha256").update(parts.join("\n")).digest("hex")}`;
}

function storeId(directory: string): string {
  return fingerprint([resolve(directory)]);
}

function storeFingerprint(directory: string, filenames: string[]): string {
  const details = filenames.map((filename) => {
    const stats = statSync(join(directory, filename));
    return `${filename}\u0000${stats.size}\u0000${stats.mtimeMs}`;
  });
  return fingerprint(details);
}

function markdownFilenames(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** Discover populated Claude Code project-memory directories without reading their content. */
export function discoverClaudeProjectMemoryStores(projectsDir: string): ClaudeProjectMemoryStore[] {
  if (!existsSync(projectsDir)) return [];
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(projectsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }

  const stores: ClaudeProjectMemoryStore[] = [];
  for (const projectDir of projectDirs) {
    const directory = join(projectsDir, projectDir, "memory");
    if (!existsSync(directory)) continue;
    const filenames = markdownFilenames(directory);
    if (filenames.length === 0) continue;
    try {
      stores.push({
        directory,
        id: storeId(directory),
        slug: claudeProjectDirToSlug(projectDir),
        fileCount: filenames.length,
        fingerprint: storeFingerprint(directory, filenames),
      });
    } catch {
      // A concurrent Claude write can briefly race file metadata collection.
      // The next non-blocking sync will pick it up.
    }
  }
  return stores;
}

export function resolveClaudeProjectsDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env.AGENTBREW_CLAUDE_PROJECTS_DIR ?? env.DOTFILES_CLAUDE_PROJECTS_DIR ?? join(home, ".claude", "projects");
}

function resolveMcpUrl(env: NodeJS.ProcessEnv): string {
  return env.AGENTBREW_MEMORY_MCP_URL ?? env.DOTFILES_MEMORY_MCP_URL ?? MEMORY_MCP_URL;
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number.parseInt(value, 10);
  return parsed > 0 ? parsed : undefined;
}

function resolveSyncTimeoutMs(env: NodeJS.ProcessEnv): number {
  const milliseconds = positiveInteger(env.AGENTBREW_MEMORY_SYNC_TIMEOUT_MS);
  if (milliseconds) return milliseconds;
  const seconds = positiveInteger(env.DOTFILES_MEMORY_SYNC_TIMEOUT);
  return seconds ? seconds * 1_000 : DEFAULT_SYNC_TIMEOUT_MS;
}

/** Stable provenance tag. The store ID hashes the resolved directory, never exposing it. */
export function projectMemorySourceTag(store: Pick<ClaudeProjectMemoryStore, "id">): string {
  return `${PROJECT_MEMORY_SOURCE_TAG_PREFIX}${store.id}`;
}

/** Readable project label retained for intentional broad project filtering. */
export function projectMemoryLabelTag(store: Pick<ClaudeProjectMemoryStore, "slug">): string {
  return `project:${store.slug}`;
}

function ingestOptions(store: ClaudeProjectMemoryStore): MemoryIngestOptions {
  return {
    directoryPath: store.directory,
    fileExtensions: ["md"],
    recursive: false,
    memoryType: "reference",
    chunkSize: 2_000,
    tags: [PROJECT_MEMORY_TAG, projectMemorySourceTag(store), projectMemoryLabelTag(store)],
  };
}

function isStoreStale(store: ClaudeProjectMemoryStore, ledger: ProjectMemorySyncLedger | undefined): boolean {
  const prior = ledger?.stores[store.id];
  return prior?.fingerprint !== store.fingerprint || prior.fileCount !== store.fileCount;
}

function storesToSync(
  stores: ClaudeProjectMemoryStore[],
  ledger: ProjectMemorySyncLedger | undefined,
  force = false,
): ClaudeProjectMemoryStore[] {
  return force ? stores : stores.filter((store) => isStoreStale(store, ledger));
}

function projectMemorySyncStatus(
  stores: ClaudeProjectMemoryStore[],
  ledger: ProjectMemorySyncLedger | undefined,
  force = false,
): ProjectMemorySyncCheck {
  if (stores.length === 0) return { stores: 0, stale: 0, status: "none" };
  const stale = storesToSync(stores, ledger, force).length;
  return {
    stores: stores.length,
    stale,
    status: stale === 0 ? "ok" : "drifted",
    ...(ledger?.lastSuccessfulAt ? { lastSuccessfulAt: ledger.lastSuccessfulAt } : {}),
  };
}

/** Report project-memory drift using metadata only. It never contacts the MCP daemon. */
export function checkProjectMemorySync(
  options: Pick<ProjectMemorySyncOptions, "projectsDir" | "env" | "ledger" | "force"> = {},
): ProjectMemorySyncCheck {
  const projectsDir = options.projectsDir ?? resolveClaudeProjectsDir(options.env);
  const stores = discoverClaudeProjectMemoryStores(projectsDir);
  const ledger = options.ledger ?? readProjectMemorySyncLedger();
  return projectMemorySyncStatus(stores, ledger, options.force);
}

function nextLedgerStores(
  stores: ClaudeProjectMemoryStore[],
  previous: ProjectMemorySyncLedger | undefined,
): ProjectMemorySyncLedger["stores"] {
  return Object.fromEntries(
    stores.flatMap((store) => {
      const prior = previous?.stores[store.id];
      return prior ? [[store.id, prior] as const] : [];
    }),
  );
}

function noProjectStoresResult(): ProjectMemorySyncResult {
  return { stores: 0, synced: 0, skipped: 0, unchanged: 0, status: "none", results: [] };
}

function dryRunResult(
  stores: ClaudeProjectMemoryStore[],
  ledger: ProjectMemorySyncLedger | undefined,
  force: boolean,
): ProjectMemorySyncResult {
  const targets = new Set(storesToSync(stores, ledger, force).map((store) => store.id));
  const results = stores.map((store) =>
    targets.has(store.id)
      ? { slug: store.slug, files: store.fileCount, status: "would-sync" as const }
      : { slug: store.slug, files: store.fileCount, status: "unchanged" as const },
  );
  return {
    stores: stores.length,
    synced: results.filter((result) => result.status === "would-sync").length,
    skipped: 0,
    unchanged: results.filter((result) => result.status === "unchanged").length,
    status: "ok",
    results,
  };
}

async function initializeClient(client: MemoryMcpClient): Promise<boolean> {
  try {
    return await client.initialize();
  } catch {
    return false;
  }
}

function unavailableResults(stores: ClaudeProjectMemoryStore[]): ProjectMemorySyncStoreResult[] {
  return stores.map((store) => ({
    slug: store.slug,
    files: store.fileCount,
    status: "skipped",
    detail: "daemon-unavailable",
  }));
}

async function ingestStores(
  client: MemoryMcpClient,
  stores: ClaudeProjectMemoryStore[],
  nextStores: ProjectMemorySyncLedger["stores"],
  now: () => Date,
): Promise<ProjectMemorySyncStoreResult[]> {
  const results: ProjectMemorySyncStoreResult[] = [];
  for (const store of stores) {
    try {
      const ingest = await client.memoryIngest(ingestOptions(store));
      nextStores[store.id] = {
        fingerprint: store.fingerprint,
        fileCount: store.fileCount,
        lastSyncedAt: now().toISOString(),
        chunksStored: ingest.chunksStored,
      };
      results.push({
        slug: store.slug,
        files: store.fileCount,
        status: "synced",
        chunksStored: ingest.chunksStored,
      });
    } catch {
      results.push({
        slug: store.slug,
        files: store.fileCount,
        status: "skipped",
        detail: "daemon-unavailable",
      });
    }
  }
  return results;
}

function resultFromStoreResults(
  stores: ClaudeProjectMemoryStore[],
  results: ProjectMemorySyncStoreResult[],
): ProjectMemorySyncResult {
  const synced = results.filter((result) => result.status === "synced").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  const unchanged = results.filter((result) => result.status === "unchanged").length;
  return {
    stores: stores.length,
    synced,
    skipped,
    unchanged,
    status: skipped > 0 ? "degraded" : "ok",
    results,
  };
}

function combineStoreResults(
  stores: ClaudeProjectMemoryStore[],
  targets: ClaudeProjectMemoryStore[],
  targetResults: ProjectMemorySyncStoreResult[],
): ProjectMemorySyncStoreResult[] {
  const resultsById = new Map(targets.map((store, index) => [store.id, targetResults[index]]));
  return stores.map(
    (store) =>
      resultsById.get(store.id) ?? {
        slug: store.slug,
        files: store.fileCount,
        status: "unchanged",
      },
  );
}

function writeSyncEvidence(
  result: ProjectMemorySyncResult,
  previous: ProjectMemorySyncLedger | undefined,
  stores: ProjectMemorySyncLedger["stores"],
  now: () => Date,
  writeLedger: (ledger: ProjectMemorySyncLedger) => void,
): void {
  const attemptedAt = now().toISOString();
  const lastSuccessfulAt = result.status === "ok" ? attemptedAt : previous?.lastSuccessfulAt;
  try {
    writeLedger({
      version: 1,
      lastAttemptedAt: attemptedAt,
      ...(lastSuccessfulAt ? { lastSuccessfulAt } : {}),
      status: result.status,
      stores,
    });
  } catch {
    // Sync evidence is advisory. Permission or disk failures must not make
    // delivery automation, launchd, or Claude session shutdown fail.
  }
}

function createProjectMemoryClient(options: ProjectMemorySyncOptions, env: NodeJS.ProcessEnv): MemoryMcpClient {
  if (options.client) return options.client;
  const createClient = options.createClient ?? ((clientOptions) => createFetchMemoryMcpClient(clientOptions));
  return createClient({
    url: resolveMcpUrl(env),
    timeoutMs: resolveSyncTimeoutMs(env),
  });
}

async function syncStoreResults(
  options: ProjectMemorySyncOptions,
  env: NodeJS.ProcessEnv,
  stores: ClaudeProjectMemoryStore[],
  nextStores: ProjectMemorySyncLedger["stores"],
  now: () => Date,
): Promise<ProjectMemorySyncStoreResult[]> {
  try {
    const client = createProjectMemoryClient(options, env);
    return (await initializeClient(client))
      ? await ingestStores(client, stores, nextStores, now)
      : unavailableResults(stores);
  } catch {
    return unavailableResults(stores);
  }
}

/**
 * Ingest populated Claude project-memory stores into the managed shared MCP.
 * This intentionally degrades instead of throwing: Ship It, the daily
 * LaunchAgent, and the SessionEnd hook must never be blocked by memory health.
 */
export async function syncClaudeProjectMemories(
  options: ProjectMemorySyncOptions = {},
): Promise<ProjectMemorySyncResult> {
  const env = options.env ?? process.env;
  const projectsDir = options.projectsDir ?? resolveClaudeProjectsDir(env);
  const stores = discoverClaudeProjectMemoryStores(projectsDir);
  if (stores.length === 0) return noProjectStoresResult();

  const now = options.now ?? (() => new Date());
  const previous = options.ledger ?? readProjectMemorySyncLedger();
  const force = options.force ?? false;
  if (options.dryRun) return dryRunResult(stores, previous, force);

  const targets = storesToSync(stores, previous, force);
  const nextStores = nextLedgerStores(stores, previous);
  const targetResults = targets.length > 0 ? await syncStoreResults(options, env, targets, nextStores, now) : [];
  const results = combineStoreResults(stores, targets, targetResults);
  const result = resultFromStoreResults(stores, results);
  writeSyncEvidence(result, previous, nextStores, now, options.writeLedger ?? writeProjectMemorySyncLedger);
  return result;
}
