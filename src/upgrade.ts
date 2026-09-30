import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import semver from "semver";
import { logSkipped } from "./core/logger.js";

function getCurrentVersion(): string {
  try {
    const packageJsonPath = join(import.meta.dirname, "..", "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version: string };
    return packageJson.version;
  } catch (e) {
    logSkipped("upgrade/parse", e);
    return "unknown";
  }
}

function fetchLatestVersion(): string | undefined {
  try {
    const output = execFileSync("npm", ["view", "agentbrew", "version"], {
      stdio: "pipe",
      timeout: 15_000,
      encoding: "utf-8",
    });
    return output.trim();
  } catch (e) {
    logSkipped("upgrade/trim", e);
    return undefined;
  }
}

function fetchChangelog(fromVersion: string, toVersion: string): string | undefined {
  try {
    const output = execFileSync("npm", ["view", "agentbrew", "versions", "--json"], {
      stdio: "pipe",
      timeout: 15_000,
      encoding: "utf-8",
    });
    const allVersions = JSON.parse(output) as string[];
    const fromIndex = allVersions.indexOf(fromVersion);
    const toIndex = allVersions.indexOf(toVersion);
    if (fromIndex === -1 || toIndex === -1 || fromIndex >= toIndex) return undefined;
    const newVersions = allVersions.slice(fromIndex + 1, toIndex + 1);
    return newVersions.join(", ");
  } catch (e) {
    logSkipped("upgrade/join", e);
    return undefined;
  }
}

function detectInstallMethod(): "global" | "npx" | "local" {
  const execPath = process.argv[1] ?? "";
  if (execPath.includes("npx") || execPath.includes("_npx")) return "npx";
  try {
    const globalPrefix = execFileSync("npm", ["prefix", "-g"], { stdio: "pipe", encoding: "utf-8", timeout: 10_000 })
      .toString()
      .trim();
    if (execPath.startsWith(globalPrefix)) return "global";
  } catch (e) {
    logSkipped("upgrade/trim", e);
    // Can't detect global prefix
  }
  return "local";
}

interface UpgradeResult {
  currentVersion: string;
  latestVersion: string | undefined;
  updateAvailable: boolean;
  method: "global" | "npx" | "local";
  upgraded: boolean;
}

export async function upgrade(options: { check?: boolean } = {}): Promise<UpgradeResult> {
  const currentVersion = getCurrentVersion();
  const method = detectInstallMethod();

  console.log(chalk.bold("\nagentbrew upgrade\n"));
  console.log(`  Current version: ${chalk.cyan(currentVersion)}`);
  console.log(`  Install method:  ${chalk.dim(method)}`);

  console.log(chalk.dim("\n  Checking npm registry..."));
  const latestVersion = fetchLatestVersion();

  if (!latestVersion) {
    console.error(chalk.yellow("  Could not reach npm registry."));
    console.log(chalk.dim("  Check your network connection and try again.\n"));
    return { currentVersion, latestVersion: undefined, updateAvailable: false, method, upgraded: false };
  }

  console.log(`  Latest version:  ${chalk.cyan(latestVersion)}`);

  if (!semver.gt(latestVersion, currentVersion)) {
    console.log(chalk.green("\n  ✓ Already up to date.\n"));
    return { currentVersion, latestVersion, updateAvailable: false, method, upgraded: false };
  }

  console.log(chalk.yellow(`\n  Update available: ${currentVersion} → ${latestVersion}`));

  const versions = fetchChangelog(currentVersion, latestVersion);
  if (versions) {
    console.log(chalk.dim(`  Versions: ${versions}`));
  }

  if (options.check) {
    console.log(chalk.dim("\n  Run `agentbrew upgrade` to install the update.\n"));
    return { currentVersion, latestVersion, updateAvailable: true, method, upgraded: false };
  }

  if (method === "npx") {
    console.log(chalk.yellow("\n  Installed via npx — no persistent upgrade needed."));
    console.log(chalk.dim("  Next run will automatically use the latest version."));
    console.log(chalk.dim("  Or run: npx agentbrew@latest\n"));
    return { currentVersion, latestVersion, updateAvailable: true, method, upgraded: false };
  }

  if (method === "local") {
    console.log(chalk.yellow("\n  Running from local install — upgrade manually:"));
    console.log(chalk.dim("  npm install agentbrew@latest"));
    console.log(chalk.dim("  Or: npm install -g agentbrew@latest\n"));
    return { currentVersion, latestVersion, updateAvailable: true, method, upgraded: false };
  }

  // Global install — run npm install -g
  console.log(chalk.dim("\n  Running: npm install -g agentbrew@latest"));
  try {
    execFileSync("npm", ["install", "-g", "agentbrew@latest"], { stdio: "inherit", timeout: 60_000 });
    console.log(chalk.green(`\n  ✓ Upgraded to ${latestVersion}\n`));
    return { currentVersion, latestVersion, updateAvailable: true, method, upgraded: true };
  } catch (e) {
    logSkipped("upgrade/log", e);
    console.error(chalk.red("\n  Upgrade failed."));
    console.log(chalk.dim("  Try manually: npm install -g agentbrew@latest"));
    console.log(chalk.dim("  Or with sudo: sudo npm install -g agentbrew@latest\n"));
    return { currentVersion, latestVersion, updateAvailable: true, method, upgraded: false };
  }
}
