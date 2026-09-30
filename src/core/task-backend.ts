import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import yaml from "js-yaml";
import { AGENTFILE_NAMES } from "../agentfile.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Valid task backend types. */
export type TaskBackend = "tasks-md" | "github-issues";

/** Task backend descriptor. */
export interface TaskBackendDescriptor {
  /** The backend type. */
  backend: TaskBackend;
  /** GitHub owner/repo (only for github-issues). */
  repo?: `${string}/${string}`;
  /** GitHub Project number (only for github-issues). */
  project?: number;
}

/** Agentfile task backend config. */
interface AgentfileTaskBackendConfig {
  task_backend?: TaskBackend;
  repo?: `${string}/${string}`;
  project?: number;
}

// ── Constants ───────────────────────────────────────────────────────────────────

/** Default backend when no config is present. */
const DEFAULT_BACKEND: TaskBackend = "tasks-md";

// ── Validation ─────────────────────────────────────────────────────────────────

/**
 * Validate a backend value.
 * @throws Error if the value is not a valid backend.
 */
function validateBackend(value: unknown): TaskBackend {
  if (value === "tasks-md" || value === "github-issues") {
    return value;
  }
  throw new Error(`Invalid task_backend: ${JSON.stringify(value)}. Must be "tasks-md" or "github-issues".`);
}

/**
 * Validate a GitHub repo string.
 * @throws Error if the value is not a valid repo.
 */
function validateRepo(value: unknown): `${string}/${string}` {
  if (typeof value !== "string") {
    throw new Error(`repo must be a string (owner/repo), got ${typeof value}`);
  }
  const parts = value.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`repo must be in "owner/repo" format, got "${value}"`);
  }
  return value as `${string}/${string}`;
}

/**
 * Validate a GitHub Project number.
 * @throws Error if the value is not a valid project number.
 */
function validateProject(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`project must be a positive integer, got ${JSON.stringify(value)}`);
  }
  return value;
}

// ── Resolver ───────────────────────────────────────────────────────────────────

/**
 * Process a task backend config object and return a descriptor.
 * @param config - The config object from Agentfile or tasks.config.yaml.
 * @param configSource - Name of the config source (for error messages).
 * @returns Task backend descriptor.
 */
function processConfig(config: AgentfileTaskBackendConfig, configSource: string): TaskBackendDescriptor {
  if (config.task_backend === undefined) {
    return { backend: DEFAULT_BACKEND };
  }

  const backend = validateBackend(config.task_backend);

  if (backend === "tasks-md") {
    return { backend };
  }

  const repo = config.repo ? validateRepo(config.repo) : undefined;
  const project = config.project ? validateProject(config.project) : undefined;

  if (!repo || !project) {
    throw new Error(
      `github-issues backend requires both "repo" (owner/repo) and "project" (number) in ${configSource}. Missing: ${!repo ? "repo" : ""}${!project ? "project" : ""}`,
    );
  }

  return { backend, repo, project };
}

/**
 * Resolve the task backend for a given repo path.
 * Reads from Agentfile.yaml (or .agents/tasks.config.yaml as fallback).
 * Returns the backend descriptor with default fallback to "tasks-md".
 *
 * @param repoPath - Path to the repository root.
 * @returns Task backend descriptor.
 */
export function resolveTaskBackend(repoPath: string): TaskBackendDescriptor {
  // Read the Agentfile RAW rather than via loadAgentfile: parseAgentfile sanitizes
  // task_backend/repo/project (dropping malformed values to undefined), which would
  // hide bad config as "missing". The resolver needs the raw values so processConfig
  // can throw an actionable validation error instead.
  for (const name of AGENTFILE_NAMES) {
    const agentfilePath = join(repoPath, name);
    if (!existsSync(agentfilePath)) continue;
    let raw: unknown;
    try {
      raw = yaml.load(readFileSync(agentfilePath, "utf-8"));
    } catch (error) {
      console.error(chalk.yellow(`⚠ Failed to parse ${name}: ${errorMessage(error)}`));
      break;
    }
    if (raw && typeof raw === "object") {
      return processConfig(raw as AgentfileTaskBackendConfig, "Agentfile");
    }
    break;
  }

  const tasksConfigPath = join(repoPath, ".agents", "tasks.config.yaml");
  if (existsSync(tasksConfigPath)) {
    try {
      const content = readFileSync(tasksConfigPath, "utf-8");
      const config = yaml.load(content) as AgentfileTaskBackendConfig;
      return processConfig(config, ".agents/tasks.config.yaml");
    } catch (error) {
      console.error(chalk.yellow(`⚠ Failed to parse .agents/tasks.config.yaml: ${errorMessage(error)}`));
    }
  }

  return { backend: DEFAULT_BACKEND };
}

// ── Error handling ───────────────────────────────────────────────────────────

/**
 * Get a user-friendly error message from an error.
 */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
