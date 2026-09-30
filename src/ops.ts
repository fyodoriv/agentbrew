import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import chalk from "chalk";
import { logSkipped } from "./core/logger.js";
import { AGENTS_DIR, BACKUPS_DIR, COMMANDS_DIR, SHARED_RULES_PATH } from "./paths.js";
import { AGENT_DEFINITIONS } from "./types.js";
import { ICON_SUCCESS } from "./ui/output.js";
import { expandHome } from "./utils.js";

function getBackupDir(): string {
  return expandHome(BACKUPS_DIR);
}

// ── Agent config file backup/rollback ──────────────────────────────────────

const MAX_CONFIG_SNAPSHOTS = 10;
const SNAPSHOT_PREFIX = "config-snapshot-";

function collectMdFilesFromDir(dirPath: string): string[] {
  if (!existsSync(dirPath)) return [];
  try {
    return readdirSync(dirPath)
      .filter((f) => f.endsWith(".md"))
      .map((f) => join(dirPath, f));
  } catch (e) {
    logSkipped("ops/map", e);
    /* skip unreadable */
    return [];
  }
}

function collectAgentDefinitionPaths(): string[] {
  const paths: string[] = [];
  for (const agent of AGENT_DEFINITIONS) {
    if (agent.mcpConfig) {
      const expanded = expandHome(agent.mcpConfig);
      if (existsSync(expanded)) paths.push(expanded);
    }
    if (agent.rulesFile) {
      const expanded = expandHome(agent.rulesFile);
      if (existsSync(expanded)) paths.push(expanded);
    }
    // Snapshot command files deployed to each agent
    if (agent.commandsDir) {
      paths.push(...collectMdFilesFromDir(expandHome(agent.commandsDir)));
    }
    // Snapshot agent definition files deployed to each agent
    if (agent.agentsDir) {
      paths.push(...collectMdFilesFromDir(expandHome(agent.agentsDir)));
    }
  }
  return paths;
}

/** Collect all agent config file paths that sync operations may modify. */
function collectAgentConfigPaths(): string[] {
  const paths = collectAgentDefinitionPaths();
  const home = expandHome("~");

  // Also backup shared rules and instruction template source
  const sharedRules = expandHome(SHARED_RULES_PATH);
  if (existsSync(sharedRules)) paths.push(sharedRules);

  // Backup canonical source directories
  const canonicalDirs = [expandHome(COMMANDS_DIR), expandHome(AGENTS_DIR)];
  for (const dir of canonicalDirs) {
    paths.push(...collectMdFilesFromDir(dir));
  }

  // Deduplicate (some agents share config files via readsFrom)
  return [...new Set(paths)].filter((p) => p.startsWith(home));
}

/** Create a timestamped snapshot of all agent config files that sync may modify.
 *  Snapshots are stored in `~/.config/agentbrew/backups/config-snapshot-{timestamp}/`
 *  as flat copies with relative paths encoded in the filename (/ → __). */
export function snapshotAgentConfigs(): string | undefined {
  const paths = collectAgentConfigPaths();
  if (paths.length === 0) return undefined;

  const backupDir = getBackupDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshotDir = join(backupDir, `${SNAPSHOT_PREFIX}${timestamp}`);
  mkdirSync(snapshotDir, { recursive: true });

  const home = expandHome("~");
  let copied = 0;
  for (const filePath of paths) {
    try {
      // Encode the relative path as a flat filename: ~/.cursor/mcp.json → .cursor__mcp.json
      const relativePath = relative(home, filePath);
      const flatName = relativePath.replace(/\//g, "__");
      copyFileSync(filePath, join(snapshotDir, flatName));
      copied++;
    } catch (e) {
      logSkipped("ops/copyFileSync", e);
      // Skip unreadable files — non-fatal
    }
  }

  if (copied === 0) {
    try {
      rmSync(snapshotDir, { recursive: true, force: true });
    } catch (e) {
      logSkipped("ops/rmSync", e);
      /* ignore */
    }
    return undefined;
  }

  // Prune old snapshots
  pruneOldSnapshots(backupDir);

  return snapshotDir;
}

/** Restore agent config files from the most recent snapshot. */
export async function rollbackAgentConfigs(): Promise<void> {
  const backupDir = getBackupDir();
  if (!existsSync(backupDir)) {
    console.error(chalk.yellow("No config snapshots found."));
    return;
  }

  const snapshots = readdirSync(backupDir)
    .filter((d) => d.startsWith(SNAPSHOT_PREFIX))
    .sort()
    .reverse();

  if (snapshots.length === 0) {
    console.error(chalk.yellow("No config snapshots found. Run `agentbrew sync` to create one."));
    return;
  }

  const latest = snapshots[0];
  const snapshotDir = join(backupDir, latest);
  const home = expandHome("~");

  let restored = 0;
  for (const flatName of readdirSync(snapshotDir)) {
    const relativePath = flatName.replace(/__/g, "/");
    const targetPath = join(home, relativePath);
    const sourcePath = join(snapshotDir, flatName);
    try {
      mkdirSync(dirname(targetPath), { recursive: true });
      copyFileSync(sourcePath, targetPath);
      restored++;
    } catch (e) {
      logSkipped("ops/copyFileSync", e);
      console.warn(`  ⚠ Failed to restore: ${relativePath}`);
    }
  }

  const snapshotTime = latest.replace(SNAPSHOT_PREFIX, "").replace(/-/g, ":").replace(/T/, " ").slice(0, 19);
  console.log(`${ICON_SUCCESS} Restored ${restored} config files from snapshot ${snapshotTime}`);
  console.log(chalk.dim("  Run `agentbrew sync` if you want to re-deploy current state.\n"));
}

/** Remove old snapshots beyond the retention limit. */
function pruneOldSnapshots(backupDir: string): void {
  try {
    const snapshots = readdirSync(backupDir)
      .filter((d) => d.startsWith(SNAPSHOT_PREFIX))
      .sort();
    while (snapshots.length > MAX_CONFIG_SNAPSHOTS) {
      const oldest = snapshots.shift();
      if (!oldest) break;
      rmSync(join(backupDir, oldest), { recursive: true, force: true });
    }
  } catch (e) {
    logSkipped("ops/rmSync", e);
    // Non-fatal — pruning failure shouldn't affect sync
  }
}
