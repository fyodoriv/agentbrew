import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { sync as writeFileSync } from "write-file-atomic";
import { logSkipped } from "./core/logger.js";

const MANIFEST_PATH = join(homedir(), ".config", "agentbrew", "manifest.json");

export interface Manifest {
  /** Map of absolute file path → content SHA-256 hash */
  hashes: Record<string, string>;
  /** Set of MCP server names that agentbrew has deployed. Used by prune to
   *  distinguish agentbrew-managed servers from user-added ones. */
  managedMcpServers?: string[];
  /** Set of "event:matcher" keys for hooks that agentbrew has deployed.
   *  Used to distinguish managed hooks from user-created ones. */
  managedHookKeys?: string[];
  managedHookKeysByAgent?: Record<string, string[]>;
  /** Per agent, the exact hooks agentbrew deployed ("event:matcher command").
   *  A group under a managed key can also hold the person's own hooks; only
   *  these entries are agentbrew's to replace or prune. */
  managedHookIdsByAgent?: Record<string, string[]>;
  /** The Claude Code `statusLine` value agentbrew wrote last (src/sync/statusline-sync.ts).
   *  A different value in settings.json is the user's own and is kept. */
  managedStatusLine?: unknown;
  /** Server names that the sync-time mcpm bridge tried to install via
   *  `mcpm install <name>` but mcpm could not resolve (server not in
   *  mcpm's registry). Skipped on subsequent syncs to avoid the
   *  per-server subprocess tax (~1.3s × 1 install + 1.3s × N clients).
   *  Cleared by `agentbrew sync --pull` so a refreshed mcpm registry
   *  retries every server. See `bridgeStateMcpToMcpm` in
   *  src/sync/mcp-sync.ts and `sync-idempotent-and-complete` (TASKS.md)
   *  criterion (b). */
  mcpmBridgeAttemptedMissing?: string[];
  /** Hash of everything the sync-time mcpm bridge reads, taken at the end of
   *  the last non-dry sync. The bridge skips when it matches, so a server mcpm
   *  never makes reachable does not cost every sync its mcpm spawns (#580).
   *  See `src/mcp/mcpm-bridge-fingerprint.ts`. */
  mcpmBridgeFingerprint?: string;
}

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * True when a file exists at `filePath` and agentbrew did not write its
 * current content: it is untracked (user-created) or its hash changed since
 * the last deploy. Sync must keep such a file. A read error counts as
 * unmodified, so a transient error never hides a file agentbrew owns.
 */
export function isUserModified(filePath: string, manifest: Manifest): boolean {
  if (!existsSync(filePath)) return false;
  const lastDeployedHash = manifest.hashes[filePath];
  if (!lastDeployedHash) return true;
  try {
    return contentHash(readFileSync(filePath, "utf-8")) !== lastDeployedHash;
  } catch (e) {
    logSkipped("manifest/isUserModified", e);
    return false;
  }
}

export function loadManifest(): Manifest {
  if (!existsSync(MANIFEST_PATH)) return { hashes: {} };
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8")) as Manifest;
  } catch (e) {
    logSkipped("manifest/parse", e);
    return { hashes: {} };
  }
}

export function saveManifest(manifest: Manifest): void {
  try {
    mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  } catch (e) {
    logSkipped("manifest/save", e);
  }
}

/**
 * Write a file only if the content has changed. Compares against on-disk
 * content to detect external modifications. Returns true if the file was
 * written, false if skipped.
 */
export function writeIfChanged(path: string, content: string, manifest?: Manifest): boolean {
  const hash = contentHash(content);

  if (existsSync(path)) {
    try {
      const existing = readFileSync(path, "utf-8");
      if (existing === content) {
        if (manifest) manifest.hashes[path] = hash;
        return false;
      }
    } catch (e) {
      logSkipped("manifest/readExisting", e);
      // Cannot compare — fall through to write
    }
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");

  if (manifest) manifest.hashes[path] = hash;
  return true;
}

/**
 * Remove a path from the manifest (e.g., after deleting a file).
 */
export function removeFromManifest(path: string, manifest: Manifest): void {
  delete manifest.hashes[path];
}
