import { execFileSync } from "node:child_process";
import { resolveTaskBackend } from "../core/task-backend.js";

// ── Test Helper: Dependency Injection for execFileSync ──────────────────────────────
let _execFileSyncImpl = execFileSync;

/**
 * Set a custom execFileSync implementation (for testing).
 * @internal
 */
export function _setExecFileSyncImpl(fn: typeof execFileSync): void {
  _execFileSyncImpl = fn;
}

/**
 * Reset execFileSync to the default implementation (for testing).
 * @internal
 */
export function _resetExecFileSyncImpl(): void {
  _execFileSyncImpl = execFileSync;
}

// ── Types ─────────────────────────────────────────────────────────────────────

/** Priority levels mapped to GitHub Project Priority field. */
export type TaskPriority = "P0" | "P1" | "2" | "3" | "4" | "5";

/** Status values mapped to GitHub Project Status field. */
export type TaskStatus = "Todo" | "In Progress" | "Done";

/** GitHub Issue from gh issue list --json. */
interface GhIssue {
  number: number;
  title: string;
  state: "open" | "closed";
  assignees: Array<{ login: string }>;
  labels: Array<{ name: string }>;
  body: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
}

/** Options for listing tasks. */
export interface ListTasksOptions {
  /** Owner/repo string. */
  repo: `${string}/${string}`;
  /** Project number. */
  project: number;
  /** Filter by priority (P0–P3). */
  priority?: TaskPriority;
  /** Filter by status. */
  status?: TaskStatus;
  /** Filter to unassigned only. */
  unassigned?: boolean;
}

/** Options for creating a task. */
export interface CreateTaskOptions {
  /** Owner/repo string. */
  repo: `${string}/${string}`;
  /** Project number. */
  project: number;
  /** Task title. */
  title: string;
  /** Task body. */
  body?: string;
  /** Priority level. */
  priority?: TaskPriority;
  /** Tags/labels. */
  tags?: string[];
}

/** Options for claiming a task. */
export interface ClaimTaskOptions {
  /** Owner/repo string. */
  repo: `${string}/${string}`;
  /** Issue number. */
  issueNumber: number;
  /** GitHub username to assign. */
  assignee: string;
}

/** Options for closing a task. */
export interface CloseTaskOptions {
  /** Owner/repo string. */
  repo: `${string}/${string}`;
  /** Issue number. */
  issueNumber: number;
  /** Comment to add when closing. */
  comment?: string;
}

/** Options for setting a field on a task. */
export interface SetFieldOptions {
  /** Owner/rero string. */
  repo: `${string}/${string}`;
  /** Project number. */
  project: number;
  /** Issue number. */
  issueNumber: number;
  /** Field to set: "priority" or "status". */
  field: "priority" | "status";
  /** Value to set. */
  value: TaskPriority | TaskStatus;
}

// ── Constants ───────────────────────────────────────────────────────────────────

/** Priority mapping: P0–P3 → GitHub Project Priority values. */
const PRIORITY_MAP: Record<TaskPriority, string> = {
  P0: "1",
  P1: "2",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
};

/** Status mapping: Todo/In-Progress/Done → GitHub Project Status values. */
const STATUS_MAP: Record<TaskStatus, string> = {
  Todo: "Todo",
  "In Progress": "In Progress",
  Done: "Done",
};

/** Default retry delay for rate-limit errors (seconds). */
const RATE_LIMIT_RETRY_DELAY = 5;
/** Maximum retry attempts for rate-limit errors. */
const RATE_LIMIT_MAX_RETRIES = 3;

// ── Helper Functions ─────────────────────────────────────────────────────────────

/**
 * Execute a gh command and return the parsed JSON output.
 * @throws Error if the command fails.
 */
function execGhJson(args: string[]): unknown {
  try {
    const output = _execFileSyncImpl("gh", args, { encoding: "utf-8", stdio: "pipe" }) as string;
    return JSON.parse(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`gh command failed: ${message}`);
  }
}

/** True when a gh error message indicates a GitHub API rate-limit (HTTP 403). */
function isRateLimitError(message: string): boolean {
  return message.includes("403") && message.includes("API rate limit");
}

/** Busy-wait for `ms` milliseconds (simple backoff; the caller skips it in test mode). */
function busyWaitMs(ms: number): void {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // busy wait
  }
}

/**
 * Execute a gh command, retrying on GitHub API rate-limit errors.
 * @throws Error on a non-rate-limit failure, or after RATE_LIMIT_MAX_RETRIES rate-limited attempts.
 */
function execGhWithRetry(args: string[]): void {
  for (let attempt = 1; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
    try {
      _execFileSyncImpl("gh", args, { encoding: "utf-8", stdio: "pipe" });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isRateLimitError(message)) {
        throw new Error(`gh command failed: ${message}`);
      }
      if (attempt >= RATE_LIMIT_MAX_RETRIES) {
        throw new Error(`Rate limit exceeded after ${attempt} retries`);
      }
      if (process.env.NODE_ENV !== "test") {
        busyWaitMs(RATE_LIMIT_RETRY_DELAY * attempt * 1000);
      }
    }
  }
}

/**
 * Map priority to GitHub Project Priority value.
 */
function mapPriority(priority?: TaskPriority): string | undefined {
  if (!priority) return undefined;
  return PRIORITY_MAP[priority];
}

/**
 * Map status to GitHub Project Status value.
 */
function mapStatus(status?: TaskStatus): string | undefined {
  if (!status) return undefined;
  return STATUS_MAP[status];
}

// ── Public API ──────────────────────────────────────────────────────────────────

/**
 * List open tasks from a GitHub repository, filtered by Project and optionally priority/status.
 * @param options - Listing options.
 * @returns Array of GitHub issues.
 */
export function listOpenTasks(options: ListTasksOptions): GhIssue[] {
  const { repo, project, priority, status, unassigned } = options;

  const args = ["issue", "list", "--repo", repo, "--json", "state", "open", "--search", `project:${project}`];

  if (priority) {
    args.push(`priority:${mapPriority(priority)}`);
  }

  if (status) {
    args.push(`status:${mapStatus(status)}`);
  }

  if (unassigned) {
    args.push("--assignee", "*");
  }

  const issues = execGhJson(args) as GhIssue[];
  return issues;
}

/**
 * Create a new task (issue) in a GitHub repository.
 * @param options - Creation options.
 * @returns The created issue.
 */
export function createTask(options: CreateTaskOptions): GhIssue {
  const { repo, project, title, body, priority, tags } = options;

  const args = ["issue", "create", "--repo", repo, "--title", title];

  if (body) {
    args.push("--body", body);
  }

  if (priority) {
    args.push("--label", `priority:${mapPriority(priority)}`);
  }

  if (tags && tags.length > 0) {
    for (const tag of tags) {
      args.push("--label", tag);
    }
  }

  // Add project label
  args.push("--label", `project:${project}`);

  const issue = execGhJson(args) as GhIssue;

  // Set the Project field via GraphQL (if priority/status mapping needed)
  // This would require a GraphQL query - for now, labels are sufficient

  return issue;
}

/**
 * Claim a task by assigning it to a user.
 * @param options - Claim options.
 */
export function claimTask(options: ClaimTaskOptions): void {
  const { repo, issueNumber, assignee } = options;

  const args = ["issue", "edit", `${issueNumber}`, "--repo", repo, "--add-assignee", assignee];

  execGhWithRetry(args);
}

/**
 * Close a task (issue).
 * @param options - Close options.
 */
export function closeTask(options: CloseTaskOptions): void {
  const { repo, issueNumber, comment } = options;

  const args = ["issue", "close", `${issueNumber}`, "--repo", repo];

  if (comment) {
    args.push("--comment", comment);
  }

  execGhWithRetry(args);
}

/**
 * Set a field (priority or status) on a task via GitHub Projects API.
 * @param options - Set field options.
 */
export function setField(options: SetFieldOptions): void {
  const { repo, issueNumber, field, value } = options;

  // For now, we use labels as the field mechanism
  // In a full implementation, this would use the Projects v2 GraphQL API
  const args = ["issue", "edit", `${issueNumber}`, "--repo", repo, "--add-label", `${field}:${value}`];

  execGhWithRetry(args);
}

// ── Self-Test ────────────────────────────────────────────────────────────────────

/**
 * Run a self-test to verify the gh token has the required scopes.
 * @returns Object with scope check results.
 */
export function selfTest(): {
  scopeCheck: boolean;
  projectReachable: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  let scopeCheck = false;
  let projectReachable = false;

  try {
    // Check if gh is authenticated
    const auth = execGhJson(["auth", "status"]);
    if (!auth || typeof auth !== "object") {
      errors.push("gh auth status check failed");
      return { scopeCheck: false, projectReachable: false, errors };
    }

    // Check if we can list issues (requires repo scope)
    try {
      _execFileSyncImpl("gh", ["issue", "list", "--limit", "1", "--json", "--state", "open"], {
        encoding: "utf-8",
        stdio: "pipe",
      });
      scopeCheck = true;
    } catch (_error) {
      errors.push("gh token lacks 'repo' scope or is not authenticated");
    }

    // Check if we can access Projects (requires project scope)
    // This is a basic check - in production, you'd query a specific project
    try {
      _execFileSyncImpl("gh", ["project", "list", "--limit", "1", "--json"], {
        encoding: "utf-8",
        stdio: "pipe",
      });
      projectReachable = true;
    } catch (_error) {
      errors.push("gh token lacks 'project' scope or Projects API is not accessible");
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  return { scopeCheck, projectReachable, errors };
}

/**
 * Helper function to list tasks using the task backend descriptor.
 * @param repoPath - Path to the repository.
 * @returns Array of GitHub issues.
 */
export function listTasksFromRepo(repoPath: string): GhIssue[] {
  const descriptor = resolveTaskBackend(repoPath);

  if (descriptor.backend !== "github-issues") {
    throw new Error("Repository does not use github-issues backend");
  }

  if (!descriptor.repo || !descriptor.project) {
    throw new Error("Repository is missing repo or project configuration");
  }

  return listOpenTasks({
    repo: descriptor.repo,
    project: descriptor.project,
  });
}

/**
 * Helper function to create a task using the task backend descriptor.
 * @param repoPath - Path to the repository.
 * @param title - Task title.
 * @param body - Task body.
 * @param priority - Task priority.
 * @param tags - Task tags.
 * @returns The created issue.
 */
export function createTaskFromRepo(
  repoPath: string,
  title: string,
  body?: string,
  priority?: TaskPriority,
  tags?: string[],
): GhIssue {
  const descriptor = resolveTaskBackend(repoPath);

  if (descriptor.backend !== "github-issues") {
    throw new Error("Repository does not use github-issues backend");
  }

  if (!descriptor.repo || !descriptor.project) {
    throw new Error("Repository is missing repo or project configuration");
  }

  return createTask({
    repo: descriptor.repo,
    project: descriptor.project,
    title,
    body,
    priority,
    tags,
  });
}
