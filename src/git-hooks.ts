import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { sync as writeFileSync } from "write-file-atomic";
import { errorMessage } from "./core/errors.js";
import { logSkipped } from "./core/logger.js";
import { ICON_SUCCESS } from "./ui/output.js";

const HOOK_MARKER = "# agentbrew-managed";

function getHookContent(): string {
  return `${["#!/bin/sh", HOOK_MARKER, "# Auto-sync agent config after commit", "agentbrew sync --quiet &"].join("\n")}\n`;
}

function getGitRoot(cwd?: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 5_000,
    })
      .toString()
      .trim();
  } catch (e) {
    logSkipped("git-hooks/trim", e);
    return undefined;
  }
}

function getHookPath(cwd?: string): string | undefined {
  const root = getGitRoot(cwd);
  if (!root) return undefined;
  return join(root, ".git", "hooks", "post-commit");
}

export function installHook(cwd?: string): void {
  const root = getGitRoot(cwd);
  if (!root) {
    console.error(chalk.red("Not inside a git repository."));
    return;
  }

  const hookPath = getHookPath(cwd);
  if (!hookPath) return;

  try {
    if (existsSync(hookPath)) {
      const existing = readFileSync(hookPath, "utf-8");
      if (existing.includes(HOOK_MARKER)) {
        console.log(chalk.dim("Hook already installed."));
        return;
      }
      // Existing non-agentbrew hook — append
      const appended = `${existing.trimEnd()}\n\n${getHookContent()}`;
      writeFileSync(hookPath, appended);
      chmodSync(hookPath, 0o755);
      console.log(`${ICON_SUCCESS} Appended agentbrew hook to existing post-commit hook.`);
      return;
    }

    writeFileSync(hookPath, getHookContent());
    chmodSync(hookPath, 0o755);
    console.log(`${ICON_SUCCESS} Installed post-commit hook at ${hookPath}`);
  } catch (error) {
    console.error(chalk.red(`Failed to install hook: ${errorMessage(error)}`));
  }
}

export function removeHook(cwd?: string): void {
  const hookPath = getHookPath(cwd);
  if (!hookPath || !existsSync(hookPath)) {
    console.log(chalk.dim("No post-commit hook found."));
    return;
  }

  const content = readFileSync(hookPath, "utf-8");
  if (!content.includes(HOOK_MARKER)) {
    console.log(chalk.yellow("Post-commit hook exists but is not managed by agentbrew."));
    return;
  }

  // If the hook is entirely ours, delete the file
  const lines = content.split("\n");
  const nonAgentsyncLines = lines.filter(
    (line) =>
      !line.startsWith("#!") &&
      !line.includes(HOOK_MARKER) &&
      !line.includes("agentbrew sync") &&
      !line.includes("Auto-sync agent config") &&
      line.trim() !== "",
  );

  try {
    if (nonAgentsyncLines.length === 0) {
      unlinkSync(hookPath);
      console.log(`${ICON_SUCCESS} Removed post-commit hook.`);
    } else {
      // Other content exists — remove only our lines
      const cleaned = lines
        .filter(
          (line) =>
            !line.includes(HOOK_MARKER) && !line.includes("agentbrew sync") && !line.includes("Auto-sync agent config"),
        )
        .join("\n");
      writeFileSync(hookPath, cleaned);
      chmodSync(hookPath, 0o755);
      console.log(`${ICON_SUCCESS} Removed agentbrew lines from post-commit hook.`);
    }
  } catch (error) {
    console.error(chalk.red(`Failed to remove hook: ${errorMessage(error)}`));
  }
}
