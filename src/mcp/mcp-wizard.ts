import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ExitPromptError } from "@inquirer/core";
import { checkbox, confirm, input } from "@inquirer/prompts";
import chalk from "chalk";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { loadCatalog } from "../catalog/types.js";
import { errorMessage } from "../core/errors.js";
import { addMcpServer } from "../sync/mcp-sync.js";
import { ICON_SUCCESS } from "../ui/output.js";
import type { McpServerStatus } from "./mcp-status.js";
import { getSetupInstructions } from "./mcp-status.js";
import type { EnvVarSetupInfo } from "./mcp-validation.js";

// ── Shell config helpers ─────────────────────────────────────────────────────

/**
 * Returns the path to the secrets file where MCP env vars are stored.
 * Always uses ~/.zshenv.secrets (or shell-equivalent) — never the main shell rc file
 * which may be tracked in a dotfiles git repo and accidentally committed.
 */
export function getShellConfigPath(): string {
  const shell = process.env.SHELL ?? "/bin/zsh";
  if (shell.includes("fish")) return join(homedir(), ".config", "fish", "secrets.fish");
  if (shell.includes("bash")) return join(homedir(), ".bashenv.secrets");
  return join(homedir(), ".zshenv.secrets");
}

/** Escape a value for safe embedding inside double-quoted shell strings. */
function escapeShellValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/`/g, "\\`").replace(/\$/g, "\\$");
}

/** Escape special regex characters so a literal string can be used in `new RegExp()`. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build the export statement for a shell variable using fish syntax when needed. */
function getExportStatement(varName: string, value: string): string {
  const shell = process.env.SHELL ?? "/bin/zsh";
  const safe = escapeShellValue(value);
  if (shell.includes("fish")) return `set -gx ${varName} "${safe}"`;
  return `export ${varName}="${safe}"`;
}

/** Append or update a variable export in the user's shell config file. */
export function appendToShellConfig(varName: string, value: string): void {
  const configPath = getShellConfigPath();
  const exportLine = getExportStatement(varName, value);

  try {
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, "utf-8");
      // Check if already exported — update in place
      const escapedName = escapeRegExp(varName);
      const exportPattern = new RegExp(`^(export ${escapedName}=|set -gx ${escapedName} )`, "m");
      if (exportPattern.test(content)) {
        const updated = content.replace(
          new RegExp(`^(export ${escapedName}=.*|set -gx ${escapedName} .*)$`, "m"),
          exportLine,
        );
        writeFileAtomicSync(configPath, updated);
        return;
      }
    }

    // Append
    mkdirSync(dirname(configPath), { recursive: true });
    const separator = existsSync(configPath) ? "\n" : "";
    const existing = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
    const agentbrewHeader = "# agentbrew MCP server secrets — DO NOT commit this file";
    const needsHeader = !existing.includes(agentbrewHeader);
    const block = needsHeader ? `\n${agentbrewHeader}\n${exportLine}\n` : `${separator}${exportLine}\n`;

    writeFileAtomicSync(configPath, existing + block);
    chmodSync(configPath, 0o600);
  } catch (error) {
    const reason = errorMessage(error);
    console.warn(chalk.yellow(`\n  ⚠ Could not write to ${configPath}: ${reason}`));
    console.warn(chalk.dim(`    Add this line manually:`));
    console.warn(chalk.dim(`    ${exportLine}`));
  }
}

// ── Wizard helpers ───────────────────────────────────────────────────────────

function printVarInstructions(varName: string, info: EnvVarSetupInfo): void {
  console.log(`    ${chalk.bold(varName)}: ${info.description}`);
  if (info.link) console.log(`    ${chalk.blue("→")} ${chalk.underline(info.link)}`);
  if (info.steps && info.steps.length > 0) {
    console.log();
    for (const [index, step] of info.steps.entries()) {
      console.log(`      ${chalk.dim(`${index + 1}.`)} ${step}`);
    }
  }
  console.log();
}

async function collectEnvVarValues(
  serverName: string,
  varsToSetup: string[],
  missingSet: Set<string>,
  instructions: Record<string, EnvVarSetupInfo>,
): Promise<Map<string, string> | null> {
  const collected = new Map<string, string>();
  try {
    for (const varName of varsToSetup) {
      const info = instructions[varName];
      const existingValue = process.env[varName];
      const isMissing = missingSet.has(varName);

      if (info) {
        printVarInstructions(varName, info);
      }

      const defaultValue = isMissing ? undefined : existingValue;
      const value = await input({
        message: isMissing
          ? `  Paste your ${chalk.cyan(varName)}:`
          : `  ${chalk.cyan(varName)} ${chalk.dim("(Enter to keep current)")}:`,
        default: defaultValue,
        validate: (val) => val.trim().length > 0 || "Value cannot be empty",
      });

      collected.set(varName, value.trim());
    }
  } catch (error) {
    if (error instanceof ExitPromptError) {
      console.log(chalk.yellow(`\n  ✗ Setup cancelled for ${serverName}. No changes were made.\n`));
      return null;
    }
    throw error;
  }
  return collected;
}

async function confirmAndApplyVars(serverName: string, collected: Map<string, string>): Promise<boolean> {
  // Phase 2: Confirm and apply all at once
  console.log(chalk.bold(`\n  Review — ${serverName}:`));
  for (const [varName, value] of collected) {
    const masked = value.length > 8 ? value.slice(0, 4) + "•".repeat(value.length - 8) + value.slice(-4) : "••••";
    console.log(`    ${chalk.cyan(varName)} = ${chalk.dim(masked)}`);
  }

  let shouldSave: boolean;
  try {
    shouldSave = await confirm({
      message: `  Save ${collected.size} var(s) to ${getShellConfigPath()}?`,
      default: true,
    });
  } catch (error) {
    if (error instanceof ExitPromptError) {
      console.log(chalk.yellow(`\n  ✗ Setup cancelled for ${serverName}. No changes were made.\n`));
      return false;
    }
    throw error;
  }

  // Phase 3: Commit — set process.env and optionally write to shell config
  for (const [varName, value] of collected) {
    process.env[varName] = value;
  }

  if (shouldSave) {
    for (const [varName, value] of collected) appendToShellConfig(varName, value);
    console.log(chalk.dim(`    ✓ ${collected.size} var(s) saved to ${getShellConfigPath()}`));
  } else {
    console.log(chalk.dim("    ℹ Set for this session only. Add manually:"));
    for (const [varName, value] of collected) {
      console.log(chalk.dim(`      ${getExportStatement(varName, value)}`));
    }
  }

  console.log(`  ${ICON_SUCCESS} ${serverName} configured.\n`);
  return true;
}

/** Render the server-level setup link as a blue underlined clickable URL, if set. */
function printSetupLink(server: McpServerStatus): void {
  if (!server.setupLink) return;
  console.log(`  ${chalk.blue("→")} Setup guide: ${chalk.underline(server.setupLink)}`);
}

/** Prompt the user for all required env vars and optionally write them to the shell config. Returns false if cancelled. */
export async function setupServerEnvVars(server: McpServerStatus): Promise<boolean> {
  console.log(chalk.bold(`\n  Configuring ${server.name}:`));
  if (server.note) console.log(chalk.dim(`  ${server.note}`));
  printSetupLink(server);
  console.log(chalk.dim("  Press Ctrl+C at any prompt to cancel — nothing will be saved.\n"));

  const varsToSetup = server.requiredVars;
  const missingSet = new Set(server.missingVars);

  if (missingSet.size < varsToSetup.length) {
    const alreadySet = varsToSetup.filter((v) => !missingSet.has(v));
    console.log(chalk.dim(`    Already set: ${alreadySet.join(", ")}`));
    console.log(chalk.yellow(`    Missing: ${server.missingVars.join(", ")}`));
    console.log(chalk.dim(`    All ${varsToSetup.length} var(s) will be configured together.\n`));
  }

  const instructions = getSetupInstructions(server.name);

  // Phase 1: Collect all values (no side effects)
  const collected = await collectEnvVarValues(server.name, varsToSetup, missingSet, instructions);
  if (!collected) return false; // cancelled

  return confirmAndApplyVars(server.name, collected);
}

/** Run the setup flow for a single named server (install if missing, configure env vars). */
export async function setupSingleServer(server: McpServerStatus): Promise<void> {
  console.log(chalk.bold(`\nSetup: ${server.name}\n`));
  console.log(`  ${server.description}`);
  if (server.note) console.log(chalk.dim(`  ${server.note}`));
  printSetupLink(server);
  console.log();

  try {
    if (!server.installed) {
      const shouldInstall = await confirm({
        message: `'${server.name}' is not installed. Install it first?`,
        default: true,
      });
      if (shouldInstall) await installAndSetupServer(server);
      return;
    }

    if (server.missingVars.length === 0) {
      console.log(`  ${ICON_SUCCESS} ${server.name} is fully configured.\n`);
      return;
    }

    await setupServerEnvVars(server);
  } catch (error) {
    if (error instanceof ExitPromptError) {
      console.log(chalk.yellow("\n  Setup cancelled. No changes were made.\n"));
      return;
    }
    throw error;
  }
}

/** Install a catalog server after configuring its env vars. */
async function installAndSetupServer(server: McpServerStatus): Promise<void> {
  const catalog = loadCatalog();
  const catalogServer = catalog.mcp_servers.find((s) => s.name === server.name);
  if (!catalogServer) return;

  // Setup env vars first so they're available during install
  if (server.missingVars.length > 0) {
    const completed = await setupServerEnvVars(server);
    if (!completed) return; // cancelled — don't install
  }

  console.log(chalk.dim(`  Installing ${server.name}...`));
  // Catalog entries can be stdio (command/args) OR http (url); the wizard
  // only writes the stdio side here. http transport carries through via
  // installMcpServer in cli-install.ts which uses the full catalog entry.
  await addMcpServer(
    catalogServer.name,
    catalogServer.command ?? "",
    catalogServer.args ?? [],
    catalogServer.env ?? {},
  );
}

/** Interactive multi-server selection and install from the catalog. */
export async function installSelectedServers(
  notInstalled: McpServerStatus[],
  statuses: McpServerStatus[],
): Promise<void> {
  const installNew = await confirm({
    message: `${notInstalled.length} additional servers available. Browse and install?`,
    default: false,
  });

  if (!installNew) return;

  const choices = notInstalled.map((server) => ({
    name: `${server.name} — ${server.description}`,
    value: server.name,
    checked: false,
  }));

  const selected = await checkbox({ message: "Select servers to install:", choices });

  for (const serverName of selected) {
    const serverStatus = statuses.find((s) => s.name === serverName);
    if (!serverStatus) continue;
    await installAndSetupServer(serverStatus);
  }
}
