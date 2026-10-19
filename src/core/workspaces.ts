// Workspace-aware sync: discover per-repo Agentfiles across one or more
// workspace folders and fold them into one generated Agentfile, so a single
// `agentbrew sync` applies every repo's declarations. Workspace roots come
// from `--workspaces`, `--workspace-name`, or the global Agentfile's
// `workspaceRoots:`. Names resolve through the `tasks` CLI's shared config
// (`$XDG_CONFIG_HOME/tasks-md/workspaces.json`), so a workspace added with
// `tasks workspaces add` works here too. No roots declared → no workspace
// mode, and sync behaves exactly as before.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import chalk from "chalk";
import yaml from "js-yaml";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import {
  AGENTFILE_NAMES,
  type Agentfile,
  globalAgentfileDir,
  loadAgentfileFromPath,
  mergeAgentfiles,
} from "../agentfile.js";
import { loadState } from "../state.js";
import { expandHome } from "../utils.js";

export interface WorkspaceRoot {
  name: string;
  root: string;
}

export interface WorkspaceRepo {
  /** `<workspace>::<repo>`, the id every diagnostic uses. */
  id: string;
  agentfilePath: string;
  agentfile: Agentfile;
}

export interface Workspace extends WorkspaceRoot {
  repos: WorkspaceRepo[];
}

export interface WorkspaceCollision {
  kind: "mcp" | "defaultModel" | "defaultEffort";
  name: string;
  /** Every repo that declares the name, grouped by value. */
  owners: string[];
  /** The repo whose value the merge keeps: the last one in merge order. */
  winner: string;
}

export interface WorkspaceSelectionOptions {
  workspaces?: string;
  workspaceName?: string;
}

/** Fields that describe one repo, never the whole host; they stay out of the merged Agentfile. */
const REPO_SCOPED_FIELDS = ["task_backend", "repo", "project"] as const;

const SKIPPED_DIRS = new Set(["node_modules"]);

export function tasksMdWorkspacesPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "tasks-md", "workspaces.json");
}

/** Workspaces from the `tasks` CLI config. Missing or malformed config → empty list. */
export function loadTasksMdWorkspaces(path = tasksMdWorkspacesPath()): WorkspaceRoot[] {
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as { workspaces?: unknown };
    if (!Array.isArray(raw.workspaces)) return [];
    return raw.workspaces
      .filter((entry): entry is WorkspaceRoot => typeof entry?.name === "string" && typeof entry?.root === "string")
      .map((entry) => ({ name: entry.name, root: resolve(expandHome(entry.root)) }));
  } catch {
    return [];
  }
}

/** A root entry is a tasks-md workspace name or a path. */
function resolveRootEntry(entry: string, named: WorkspaceRoot[]): WorkspaceRoot {
  const match = named.find((workspace) => workspace.name === entry);
  if (match) return match;
  const root = resolve(expandHome(entry));
  return { name: basename(root), root };
}

/**
 * Which workspaces this run covers. `--workspaces` wins, then `--workspace-name`,
 * then `workspaceRoots:` in the base Agentfile. `undefined` means workspace mode is off.
 */
export function resolveWorkspaceRoots(
  options: WorkspaceSelectionOptions,
  baseAgentfile: Agentfile | undefined,
  named: WorkspaceRoot[] = loadTasksMdWorkspaces(),
): WorkspaceRoot[] | undefined {
  if (options.workspaces) {
    const entries = options.workspaces
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    return entries.map((entry) => resolveRootEntry(entry, named));
  }
  if (options.workspaceName) {
    const match = named.find((workspace) => workspace.name === options.workspaceName);
    if (!match) throw new Error(`Unknown workspace "${options.workspaceName}" (not in ${tasksMdWorkspacesPath()})`);
    return [match];
  }
  const declared = baseAgentfile?.workspaceRoots;
  if (!declared?.length) return undefined;
  return declared.map((entry) => resolveRootEntry(entry, named));
}

function findAgentfileIn(directory: string): string | undefined {
  for (const name of AGENTFILE_NAMES) {
    const path = join(directory, name);
    if (existsSync(path)) return path;
  }
  return undefined;
}

/** Each direct child folder of a workspace root that holds an Agentfile is a repo, sorted by name. */
export function discoverWorkspaces(roots: WorkspaceRoot[]): Workspace[] {
  return roots.map(({ name, root }) => {
    const repos: WorkspaceRepo[] = [];
    const children = existsSync(root) ? readdirSync(root, { withFileTypes: true }) : [];
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!child.isDirectory() || child.name.startsWith(".") || SKIPPED_DIRS.has(child.name)) continue;
      const agentfilePath = findAgentfileIn(join(root, child.name));
      if (!agentfilePath) continue;
      const agentfile = loadAgentfileFromPath(agentfilePath);
      if (!agentfile) continue;
      repos.push({ id: `${name}::${child.name}`, agentfilePath, agentfile });
    }
    return { name, root, repos };
  });
}

function mcpName(entry: NonNullable<Agentfile["mcp"]>[number]): string {
  return typeof entry === "string" ? entry : entry.name;
}

function recordValue(values: Map<string, Map<string, string[]>>, key: string, value: string, owner: string): void {
  const byValue = values.get(key) ?? new Map<string, string[]>();
  byValue.set(value, [...(byValue.get(value) ?? []), owner]);
  values.set(key, byValue);
}

/** Declarations two repos make differently: same MCP name with another definition, or another default model. */
export function findWorkspaceCollisions(workspaces: Workspace[]): WorkspaceCollision[] {
  const values = new Map<string, Map<string, string[]>>();
  const last = new Map<string, string>();
  const note = (key: string, value: string, owner: string) => {
    recordValue(values, key, value, owner);
    last.set(key, owner);
  };
  for (const repo of workspaces.flatMap((workspace) => workspace.repos)) {
    for (const entry of repo.agentfile.mcp ?? []) {
      note(`mcp\0${mcpName(entry)}`, JSON.stringify(entry), repo.id);
    }
    if (repo.agentfile.defaultModel) note("defaultModel\0", repo.agentfile.defaultModel, repo.id);
    if (repo.agentfile.defaultEffort) note("defaultEffort\0", repo.agentfile.defaultEffort, repo.id);
  }
  const collisions: WorkspaceCollision[] = [];
  for (const [key, byValue] of values) {
    if (byValue.size < 2) continue;
    const [kind, name] = key.split("\0") as [WorkspaceCollision["kind"], string];
    collisions.push({ kind, name: name || kind, owners: [...byValue.values()].flat(), winner: last.get(key) ?? "" });
  }
  return collisions;
}

export function formatCollision(collision: WorkspaceCollision): string {
  const label = collision.kind === "mcp" ? `MCP server "${collision.name}"` : collision.kind;
  return `${label} differs between ${collision.owners.join(" and ")}; using ${collision.winner} unless the base Agentfile sets it`;
}

/**
 * Merge every repo Agentfile, then the base Agentfile last so it wins every
 * conflict. Repo-scoped fields (task backend, repo, project) come only from the base.
 */
export function writeWorkspaceAgentfile(
  basePath: string | undefined,
  workspaces: Workspace[],
  outputPath: string,
): string {
  const repoPaths = workspaces.flatMap((workspace) => workspace.repos.map((repo) => repo.agentfilePath));
  const paths = basePath ? [...repoPaths, basePath] : repoPaths;
  const merged = (paths.length ? yaml.load(mergeAgentfiles(paths)) : {}) as Record<string, unknown> | undefined;
  const output = merged ?? {};
  const base = basePath ? loadAgentfileFromPath(basePath) : undefined;
  for (const field of REPO_SCOPED_FIELDS) {
    if (base?.[field] === undefined) delete output[field];
  }
  const expanded = expandHome(outputPath);
  mkdirSync(dirname(expanded), { recursive: true });
  writeFileAtomicSync(
    expanded,
    `# Generated by agentbrew workspace sync. Do not edit; edit the per-repo Agentfiles.\n${yaml.dump(output, { lineWidth: 120, noRefs: true })}`,
    "utf-8",
  );
  return expanded;
}

/** Where the merged workspace Agentfile is written; outside every Agentfile lookup path. */
export function workspaceAgentfilePath(): string {
  return expandHome("~/.config/agentbrew/generated/workspace-Agentfile.yaml");
}

export interface WorkspaceSyncOptions extends WorkspaceSelectionOptions {
  /** An explicit `--agentfile`; it replaces the global Agentfile as the base. */
  agentfile?: string;
}

/** The base Agentfile file: the explicit one (file or folder), else the global one. */
export function resolveBaseAgentfilePath(agentfile: string | undefined): string | undefined {
  const target = resolve(expandHome(agentfile ?? globalAgentfileDir()));
  if (!existsSync(target)) return undefined;
  return statSync(target).isDirectory() ? findAgentfileIn(target) : target;
}

/**
 * Discover, report, and merge the workspaces this run covers. Returns the
 * generated Agentfile path, or `undefined` when workspace mode is off.
 */
export function prepareWorkspaceAgentfile(options: WorkspaceSyncOptions): string | undefined {
  const basePath = resolveBaseAgentfilePath(options.agentfile);
  const base = basePath ? loadAgentfileFromPath(basePath) : undefined;
  const roots = resolveWorkspaceRoots(options, base);
  if (!roots) return undefined;
  const workspaces = discoverWorkspaces(roots);
  for (const workspace of workspaces) {
    const repos = workspace.repos.map((repo) => repo.id.split("::")[1]).join(", ") || "no Agentfiles";
    console.log(chalk.dim(`  Workspace ${workspace.name} (${workspace.root}): ${repos}`));
  }
  for (const collision of findWorkspaceCollisions(workspaces)) {
    console.warn(chalk.yellow(`  ⚠ ${formatCollision(collision)}`));
  }
  return writeWorkspaceAgentfile(basePath, workspaces, workspaceAgentfilePath());
}

function markDeployed(names: string[], deployed: Set<string>): string {
  return names
    .map((name) => (deployed.has(name) ? chalk.green(name) : chalk.yellow(`${name} (not deployed)`)))
    .join(", ");
}

function printRepoStatus(repo: WorkspaceRepo, deployedMcp: Set<string>, deployedSkills: Set<string>): void {
  console.log(`    ${repo.id} ${chalk.dim(repo.agentfilePath)}`);
  const mcp = (repo.agentfile.mcp ?? []).map(mcpName);
  if (mcp.length) console.log(`      mcp: ${markDeployed(mcp, deployedMcp)}`);
  const skills = repo.agentfile.skills ?? [];
  if (skills.length) console.log(`      skills: ${markDeployed(skills, deployedSkills)}`);
}

/** `agentbrew status` section: per workspace, each repo's Agentfile and whether its items reached state. */
export function printWorkspaceStatus(options: WorkspaceSyncOptions): void {
  const basePath = resolveBaseAgentfilePath(options.agentfile);
  const roots = resolveWorkspaceRoots(options, basePath ? loadAgentfileFromPath(basePath) : undefined);
  if (!roots) return;
  const state = loadState();
  const deployedMcp = new Set((state?.mcpServers ?? []).map((server) => server.name));
  const deployedSkills = new Set(state?.agentfileSkills ?? []);
  const targets = (state?.agents ?? []).filter((agent) => agent.detected).map((agent) => agent.name);
  const workspaces = discoverWorkspaces(roots);
  console.log(chalk.bold("\nWorkspaces\n"));
  console.log(`  Targets: ${targets.join(", ") || "none detected"}`);
  for (const workspace of workspaces) {
    console.log(`\n  ${chalk.bold(workspace.name)} ${chalk.dim(workspace.root)}`);
    if (!workspace.repos.length) console.log(chalk.dim("    no per-repo Agentfiles"));
    for (const repo of workspace.repos) printRepoStatus(repo, deployedMcp, deployedSkills);
  }
  for (const collision of findWorkspaceCollisions(workspaces)) {
    console.log(chalk.yellow(`\n  ⚠ ${formatCollision(collision)}`));
  }
  console.log("");
}
