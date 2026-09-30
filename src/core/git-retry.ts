import { type ExecFileSyncOptions, execFileSync } from "node:child_process";

/** Default timeout for git operations, overridden by AGENTBREW_GIT_TIMEOUT env var. */
function getGitTimeout(defaultMs: number): number {
  const envTimeout = process.env.AGENTBREW_GIT_TIMEOUT;
  if (envTimeout) {
    const parsed = Number.parseInt(envTimeout, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed * 1000; // env is in seconds
  }
  return defaultMs;
}

/** Classify a git error as transient (retryable) or permanent (not retryable). */
function isTransientError(error: unknown): boolean {
  const msg = String(error);
  // ENOENT means git binary is not installed — retrying won't help
  if (/ENOENT|spawn.*ENOENT/i.test(msg)) {
    return false;
  }
  // Auth failures and not-found are permanent
  if (/Permission denied|Authentication failed|Repository not found|Could not read from remote/i.test(msg)) {
    return false;
  }
  // Timeouts, connection refused, DNS resolution, and generic network errors are transient
  if (/timed out|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|Could not resolve host|network/i.test(msg)) {
    return true;
  }
  // Default: treat as transient (better to retry once too many than crash)
  return true;
}

/** Sleep for a given number of milliseconds without burning CPU. */
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

interface GitExecOptions {
  /** Working directory for the git command. */
  cwd?: string;
  /** Timeout in milliseconds (overridden by AGENTBREW_GIT_TIMEOUT if set). */
  timeout?: number;
  /** stdio configuration (default: "pipe"). */
  stdio?: ExecFileSyncOptions["stdio"];
  /** Maximum retry attempts (default: 3). Set to 1 to disable retries. */
  maxRetries?: number;
  /** Whether this is a network operation that should use the env timeout override. */
  network?: boolean;
}

/**
 * Execute a git command with retry and exponential backoff for transient errors.
 * Non-transient errors (auth failures, repo not found) fail immediately.
 */
export function gitExec(args: string[], options: GitExecOptions = {}): Buffer {
  const maxRetries = options.maxRetries ?? 3;
  const baseTimeout = options.timeout ?? 30_000;
  const timeout = options.network !== false ? getGitTimeout(baseTimeout) : baseTimeout;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return execFileSync("git", args, {
        cwd: options.cwd,
        stdio: options.stdio ?? "pipe",
        timeout,
      });
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries || !isTransientError(error)) {
        break;
      }
      const backoff = Math.min(1000 * 2 ** (attempt - 1), 10_000);
      sleep(backoff);
    }
  }
  throw lastError;
}
