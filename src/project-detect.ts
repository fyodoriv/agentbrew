import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { AGENTFILE_NAMES } from "./agentfile.js";
import { logSkipped } from "./core/logger.js";

/** Detected project-level agent assets. */
interface ProjectAssets {
  /** Agentfile.yaml or another supported Agentfile name found at the directory root. */
  agentfile?: string;
  /** Project skills directories (e.g., .claude/skills/ with N skills). */
  skills: Array<{ agent: string; count: number }>;
  /** Project rules directories (e.g., .cursor/rules/ with N files). */
  rules: Array<{ agent: string; count: number }>;
  /** Project commands directories. */
  commands: Array<{ agent: string; count: number }>;
  /** Project instruction files (AGENTS.md, GEMINI.md, etc.). */
  instructions: string[];
}

/** Agent directories to scan for project-level assets. */
const SKILL_DIRS = [
  { agent: "claude", dir: ".claude/skills" },
  { agent: "cursor", dir: ".cursor/skills" },
];

const RULES_DIRS = [{ agent: "cursor", dir: ".cursor/rules" }];

const COMMAND_DIRS = [
  { agent: "claude", dir: ".claude/commands" },
  { agent: "cursor", dir: ".cursor/commands" },
];

const INSTRUCTION_FILES = ["AGENTS.md", "GEMINI.md", ".github/copilot-instructions.md"];

/** Count entries in a directory, optionally filtering by extensions. */
function countDirEntries(dirPath: string, extensions?: string[]): number {
  try {
    const entries = readdirSync(dirPath);
    if (!extensions) return entries.length;
    return entries.filter((f) => extensions.some((ext) => f.endsWith(ext))).length;
  } catch (e) {
    logSkipped("project-detect/filter", e);
    return 0;
  }
}

function scanAssetDirs(
  directory: string,
  dirs: Array<{ agent: string; dir: string }>,
  extensions?: string[],
): Array<{ agent: string; count: number }> {
  const results: Array<{ agent: string; count: number }> = [];
  for (const { agent, dir } of dirs) {
    const fullDir = join(directory, dir);
    if (!existsSync(fullDir)) continue;
    const count = countDirEntries(fullDir, extensions);
    if (count > 0) results.push({ agent, count });
  }
  return results;
}

/** Scan a directory for project-level agent assets. Fast — only existsSync + readdirSync. */
export function detectProjectAssets(directory: string): ProjectAssets | undefined {
  const assets: ProjectAssets = {
    skills: [],
    rules: [],
    commands: [],
    instructions: [],
  };

  assets.agentfile = AGENTFILE_NAMES.find((name) => existsSync(join(directory, name)));
  assets.skills = scanAssetDirs(directory, SKILL_DIRS);
  assets.rules = scanAssetDirs(directory, RULES_DIRS, [".md", ".mdc"]);
  assets.commands = scanAssetDirs(directory, COMMAND_DIRS, [".md"]);

  for (const file of INSTRUCTION_FILES) {
    if (existsSync(join(directory, file))) {
      assets.instructions.push(file);
    }
  }

  const hasAssets =
    assets.agentfile !== undefined ||
    assets.skills.length > 0 ||
    assets.rules.length > 0 ||
    assets.commands.length > 0 ||
    assets.instructions.length > 0;

  return hasAssets ? assets : undefined;
}

/** Format detected project assets as a concise summary string. */
export function formatProjectAssets(assets: ProjectAssets): string {
  const lines: string[] = [];

  lines.push(chalk.bold("  Project agent assets:\n"));

  if (assets.agentfile) {
    lines.push(`    ${chalk.cyan(assets.agentfile)} — declarative manifest`);
  }

  for (const { agent, count } of assets.skills) {
    lines.push(`    ${count} skill(s) in ${chalk.dim(`.${agent}/skills/`)}`);
  }

  for (const { agent, count } of assets.rules) {
    lines.push(`    ${count} rule(s) in ${chalk.dim(`.${agent}/rules/`)}`);
  }

  for (const { agent, count } of assets.commands) {
    lines.push(`    ${count} command(s) in ${chalk.dim(`.${agent}/commands/`)}`);
  }

  for (const file of assets.instructions) {
    lines.push(`    ${chalk.dim(file)} — project instructions`);
  }

  return lines.join("\n");
}
