import { existsSync, lstatSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { ExitPromptError } from "@inquirer/core";
import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { getStateSources } from "./agentfile.js";
import { logSkipped } from "./core/logger.js";
import { loadManifest, removeFromManifest, saveManifest } from "./manifest.js";
import { COMMANDS_DIR, INSTALLED_SKILLS_DIR } from "./paths.js";
import { loadState, saveState } from "./state.js";
import { formatSuggestion } from "./suggest.js";
import { AGENT_DEFINITIONS } from "./types.js";
import { ICON_SUCCESS } from "./ui/output.js";
import { expandHome } from "./utils.js";

type CleanItemType = "skill" | "command" | "all";

interface CleanOptions {
  type?: CleanItemType;
  dryRun?: boolean;
  yes?: boolean;
}

interface CleanResult {
  skillsRemoved: number;
  commandsRemoved: number;
  sourceRemoved: boolean;
}

function getCommandsSourceDir(): string {
  return expandHome(COMMANDS_DIR);
}

function getSkillPluginsDir(): string {
  const agentBrewDir = process.env.AGENTBREW_DIR ?? resolve(join(import.meta.dirname, ".."));
  return join(agentBrewDir, "skill-plugins", "dev");
}

/** Remove a skill symlink from all agent skill directories. */
function cleanSkillFromAgents(name: string, dryRun: boolean, _manifest: ReturnType<typeof loadManifest>): number {
  let removed = 0;

  for (const agent of AGENT_DEFINITIONS) {
    const skillsDir = expandHome(agent.skillsDir);
    const skillPath = join(skillsDir, name);

    if (!existsSync(skillPath)) continue;

    try {
      const stat = lstatSync(skillPath);
      if (stat.isSymbolicLink() || stat.isDirectory()) {
        if (!dryRun) {
          if (stat.isSymbolicLink()) {
            unlinkSync(skillPath);
          } else {
            rmSync(skillPath, { recursive: true });
          }
        }
        removed++;
      }
    } catch (e) {
      logSkipped("clean/rmSync", e);
      // permission error or race — skip
    }
  }

  return removed;
}

/** Remove a command .md file from all agent command directories. */
function cleanCommandFromAgents(name: string, dryRun: boolean, manifest: ReturnType<typeof loadManifest>): number {
  let removed = 0;
  const fileName = name.endsWith(".md") ? name : `${name}.md`;

  for (const agent of AGENT_DEFINITIONS) {
    if (!agent.commandsDir) continue;
    const commandsDir = expandHome(agent.commandsDir);
    const commandPath = join(commandsDir, fileName);

    if (!existsSync(commandPath)) continue;

    try {
      if (!dryRun) {
        unlinkSync(commandPath);
        removeFromManifest(commandPath, manifest);
      }
      removed++;
    } catch (e) {
      logSkipped("clean/removeFromManifest", e);
      // permission error or race — skip
    }
  }

  return removed;
}

/** Remove a skill from the skill-plugins source directory. */
function cleanSkillSource(name: string, dryRun: boolean): boolean {
  const skillDir = join(getSkillPluginsDir(), name);
  if (!existsSync(skillDir)) return false;

  if (!dryRun) {
    rmSync(skillDir, { recursive: true });
  }
  return true;
}

/** Remove a skill from the installed-skills staging directory. */
function cleanInstalledSkill(name: string, dryRun: boolean): boolean {
  const stagingDir = expandHome(INSTALLED_SKILLS_DIR);
  const skillDir = join(stagingDir, name);
  if (!existsSync(skillDir)) return false;

  if (!dryRun) {
    rmSync(skillDir, { recursive: true });
  }
  return true;
}

/** Remove a skill from skillsInstalled in all source entries in state.yaml. */
function removeFromSourceState(name: string, dryRun: boolean): number {
  if (dryRun) return 0;
  const state = loadState();
  if (!state) return 0;

  let removedCount = 0;
  for (const source of getStateSources(state)) {
    const index = source.skillsInstalled.indexOf(name);
    if (index !== -1) {
      source.skillsInstalled.splice(index, 1);
      removedCount++;
    }
  }

  if (removedCount > 0) {
    saveState(state);
  }
  return removedCount;
}

/** Remove a command from the commands source directory. */
function cleanCommandSource(name: string, dryRun: boolean, manifest: ReturnType<typeof loadManifest>): boolean {
  const fileName = name.endsWith(".md") ? name : `${name}.md`;
  const commandPath = join(getCommandsSourceDir(), fileName);
  if (!existsSync(commandPath)) return false;

  if (!dryRun) {
    unlinkSync(commandPath);
    removeFromManifest(commandPath, manifest);
  }
  return true;
}

/** Auto-detect whether a name matches a skill, command, or both. */
export function detectItemTypes(name: string): CleanItemType[] {
  const types: CleanItemType[] = [];
  const fileName = name.endsWith(".md") ? name : `${name}.md`;

  // Check if it's a skill (exists in any agent's skills dir or source)
  const isSkill =
    existsSync(join(getSkillPluginsDir(), name)) ||
    AGENT_DEFINITIONS.some((a) => existsSync(join(expandHome(a.skillsDir), name)));

  // Check if it's a command (exists in any agent's commands dir or source)
  const isCommand =
    existsSync(join(getCommandsSourceDir(), fileName)) ||
    AGENT_DEFINITIONS.some((a) => a.commandsDir && existsSync(join(expandHome(a.commandsDir), fileName)));

  if (isSkill) types.push("skill");
  if (isCommand) types.push("command");
  return types;
}

/** Suggest alternatives when no match is found. */
function suggestCleanAlternatives(name: string): void {
  const allSkills = AGENT_DEFINITIONS.flatMap((a) => {
    const dir = expandHome(a.skillsDir);
    try {
      return readdirSync(dir);
    } catch (e) {
      logSkipped("clean/readdirSync", e);
      return [];
    }
  });
  const allCommands = AGENT_DEFINITIONS.flatMap((a) => {
    if (!a.commandsDir) return [];
    const dir = expandHome(a.commandsDir);
    try {
      return readdirSync(dir).map((f) => f.replace(/\.md$/, ""));
    } catch (e) {
      logSkipped("clean/readdirSync", e);
      return [];
    }
  });
  const candidates = [...new Set([...allSkills, ...allCommands])];
  console.error(chalk.red(`'${name}' not found as a skill or command in any agent.`));
  const suggestion = formatSuggestion(name, candidates);
  if (suggestion) {
    console.log(suggestion);
  } else {
    console.log(chalk.dim("  Run `agentbrew status --verbose` to see what's deployed."));
  }
}

/** Remove a skill from all agents and print result. */
function cleanSkill(
  name: string,
  dryRun: boolean,
  manifest: ReturnType<typeof loadManifest>,
  result: CleanResult,
): void {
  const agentCount = cleanSkillFromAgents(name, dryRun, manifest);
  const sourceRemoved = cleanSkillSource(name, dryRun);
  const stagingRemoved = cleanInstalledSkill(name, dryRun);
  const stateSourcesUpdated = removeFromSourceState(name, dryRun);

  if (agentCount > 0 || sourceRemoved || stagingRemoved) {
    const parts: string[] = [];
    if (agentCount > 0) parts.push(`${agentCount} agent(s)`);
    if (stagingRemoved) parts.push("staging");
    if (sourceRemoved) parts.push("source");
    if (stateSourcesUpdated > 0) parts.push(`${stateSourcesUpdated} source state(s)`);
    const icon = dryRun ? chalk.blue("~") : ICON_SUCCESS;
    const verb = dryRun ? "would remove" : "removed";
    console.log(`  ${icon} Skill '${name}' — ${verb} from ${parts.join(" + ")}`);
  }

  result.skillsRemoved = agentCount;
  result.sourceRemoved = result.sourceRemoved || sourceRemoved || stagingRemoved;
}

/** Remove a command from all agents and print result. */
function cleanCommand(
  name: string,
  dryRun: boolean,
  manifest: ReturnType<typeof loadManifest>,
  result: CleanResult,
): void {
  const agentCount = cleanCommandFromAgents(name, dryRun, manifest);
  const sourceRemoved = cleanCommandSource(name, dryRun, manifest);

  if (agentCount > 0 || sourceRemoved) {
    const parts: string[] = [];
    if (agentCount > 0) parts.push(`${agentCount} agent(s)`);
    if (sourceRemoved) parts.push("source");
    const icon = dryRun ? chalk.blue("~") : ICON_SUCCESS;
    const verb = dryRun ? "would remove" : "removed";
    console.log(`  ${icon} Command '${name}' — ${verb} from ${parts.join(" + ")}`);
  }

  result.commandsRemoved = agentCount;
  result.sourceRemoved = result.sourceRemoved || sourceRemoved;
}

/** Prompt user for confirmation. Returns false if cancelled. */
async function confirmClean(types: CleanItemType[], name: string): Promise<boolean> {
  try {
    return await confirm({
      message: `Remove ${types.join(" + ")} ${chalk.cyan(name)} from all agents?`,
      default: false,
    });
  } catch (error) {
    if (error instanceof ExitPromptError) {
      console.log(chalk.dim("\n  Cancelled.\n"));
      return false;
    }
    throw error;
  }
}

/** Resolve which types to clean. Returns empty array if nothing found. */
function resolveCleanTypes(name: string, options?: CleanOptions): CleanItemType[] {
  if (options?.type && options.type !== "all") {
    return [options.type];
  }
  return detectItemTypes(name);
}

/** Print final summary after cleaning. */
function printCleanSummary(result: CleanResult, dryRun: boolean): void {
  const total = result.skillsRemoved + result.commandsRemoved + (result.sourceRemoved ? 1 : 0);
  if (total > 0) {
    const verb = dryRun ? "Would remove" : "Done.";
    console.log(chalk.bold(`\n${verb}`), `${total} item(s) cleaned.\n`);
  } else {
    console.log(chalk.dim("\n  Nothing found to clean.\n"));
  }
}

export async function clean(name: string, options?: CleanOptions): Promise<CleanResult> {
  const dryRun = options?.dryRun ?? false;
  const manifest = loadManifest();
  const result: CleanResult = { skillsRemoved: 0, commandsRemoved: 0, sourceRemoved: false };

  const types = resolveCleanTypes(name, options);

  if (types.length === 0) {
    suggestCleanAlternatives(name);
    return result;
  }

  console.log(chalk.bold(`\n${dryRun ? "Dry run — clean" : "Cleaning"} '${name}'...\n`));

  if (!dryRun && !(options?.yes ?? false)) {
    if (!(await confirmClean(types, name))) return result;
  }

  if (types.includes("skill")) cleanSkill(name, dryRun, manifest, result);
  if (types.includes("command")) cleanCommand(name, dryRun, manifest, result);

  if (!dryRun) saveManifest(manifest);
  printCleanSummary(result, dryRun);

  return result;
}
