import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import semver from "semver";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { logSkipped } from "./core/logger.js";
import { ICON_SUCCESS } from "./ui/output.js";
import { expandHome } from "./utils.js";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_FILE = "upgrade-check.json";

interface UpgradeCache {
  checkedAt: string;
  latestVersion: string;
}

function getCachePath(): string {
  return join(expandHome("~/.config/agentbrew"), CACHE_FILE);
}

function readCache(): UpgradeCache | undefined {
  const path = getCachePath();
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as UpgradeCache;
  } catch (e) {
    logSkipped("auto-upgrade/parse", e);
    return undefined;
  }
}

function writeCache(latest: string): void {
  const path = getCachePath();
  try {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileAtomicSync(path, JSON.stringify({ checkedAt: new Date().toISOString(), latestVersion: latest }));
  } catch (e) {
    logSkipped("auto-upgrade/writeFileSync", e);
    // Best effort
  }
}

function isCacheFresh(cache: UpgradeCache): boolean {
  return Date.now() - new Date(cache.checkedAt).getTime() < CHECK_INTERVAL_MS;
}

function getCurrentVersion(): string {
  try {
    const packageJsonPath = join(import.meta.dirname, "..", "package.json");
    return (JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version: string }).version;
  } catch (e) {
    logSkipped("auto-upgrade/join", e);
    return "0.0.0";
  }
}

function isNpxRun(): boolean {
  const execPath = process.argv[1] ?? "";
  return execPath.includes("npx") || execPath.includes("_npx");
}

function isGlobalInstall(): boolean {
  const execPath = process.argv[1] ?? "";
  try {
    const prefix = execFileSync("npm", ["prefix", "-g"], { stdio: "pipe", encoding: "utf-8", timeout: 5_000 }).trim();
    return execPath.startsWith(prefix);
  } catch (e) {
    logSkipped("auto-upgrade/startsWith", e);
    return false;
  }
}

function fetchLatestVersionQuiet(): string | undefined {
  try {
    return execFileSync("npm", ["view", "agentbrew", "version"], {
      stdio: "pipe",
      timeout: 10_000,
      encoding: "utf-8",
    }).trim();
  } catch (e) {
    logSkipped("auto-upgrade/trim", e);
    return undefined;
  }
}

function doUpgrade(latestVersion: string): boolean {
  try {
    execFileSync("npm", ["install", "-g", `agentbrew@${latestVersion}`], { stdio: "pipe", timeout: 60_000 });
    return true;
  } catch (e) {
    logSkipped("auto-upgrade/execFileSync", e);
    return false;
  }
}

/**
 * Check for updates (cached, at most once per 24h). If a global install is
 * outdated, auto-upgrade silently and print one line. For npx, skip entirely.
 * Never blocks the user — errors are swallowed.
 */
export function checkForAutoUpgrade(): void {
  try {
    if (isNpxRun()) return;

    const current = getCurrentVersion();
    if (current === "0.0.0") return;

    // Check cache first
    const cache = readCache();
    let latest: string | undefined;

    if (cache && isCacheFresh(cache)) {
      latest = cache.latestVersion;
    } else {
      latest = fetchLatestVersionQuiet();
      if (latest) writeCache(latest);
    }

    if (!latest || !semver.gt(latest, current)) return;

    // Update available
    if (isGlobalInstall()) {
      const upgraded = doUpgrade(latest);
      if (upgraded) {
        console.log(`  ${ICON_SUCCESS} Auto-upgraded agentbrew ${current} → ${latest}`);
      } else {
        console.log(chalk.dim(`  Update available: agentbrew ${current} → ${latest} (run: agentbrew upgrade)`));
      }
    } else {
      console.log(chalk.dim(`  Update available: agentbrew ${current} → ${latest} (run: npm i -g agentbrew@latest)`));
    }
  } catch (e) {
    logSkipped("auto-upgrade/log", e);
    // Never fail the user's command because of an upgrade check
  }
}
