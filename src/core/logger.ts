import chalk from "chalk";

/** True when AGENTBREW_DEBUG=1 (or truthy) is set in the environment. */
export const DEBUG = Boolean(process.env.AGENTBREW_DEBUG);

/**
 * Log a skipped/ignored error that is normally swallowed by a catch block.
 *
 * Output is suppressed by default and only shown when `AGENTBREW_DEBUG=1`.
 * This turns silent `catch {}` blocks into observable diagnostics without
 * polluting normal output.
 */
export function logSkipped(context: string, error: unknown): void {
  if (!DEBUG) return;
  const msg = error instanceof Error ? error.message : String(error);
  console.error(chalk.dim(`  [debug] ${context}: ${msg}`));
}

export interface Logger {
  log(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  success(icon: string, message: string): void;
  bold(message: string): string;
  dim(message: string): string;
  green(message: string): string;
  yellow(message: string): string;
  red(message: string): string;
  cyan(message: string): string;
  blue(message: string): string;
}

/**
 * Logger creation modes:
 *   - default (quiet=false, compact=false): all calls write to stdout/stderr
 *   - quiet (quiet=true): every call is a noop — used by autoSync and tests
 *   - compact (compact=true): info/log/success are silenced; warn/error still
 *     surface so users see actionable problems. Used by `agentbrew sync`'s
 *     default output mode where the runner emits a single consolidated
 *     summary line and per-module detail is suppressed unless --verbose.
 *     The user-facing contract is ≤5 lines on a fully-converged no-op
 *     sync (compact-mode acceptance).
 *
 * `quiet` takes precedence over `compact` when both are set.
 */
export function createLogger(quiet = false, compact = false): Logger {
  const noop = () => {};
  const write = quiet ? noop : (msg: string) => console.log(msg);
  const writeErr = quiet ? noop : (msg: string) => console.error(msg);
  // In compact mode warn/error still surface — silencing them would hide
  // actionable problems (unconfigured agents, manifest write failures,
  // hardcoded secrets) that users need to see even on a no-op sync.
  const writeInfo = quiet || compact ? noop : write;
  const writeSuccess = quiet || compact ? noop : write;

  return {
    log: writeInfo,
    info: writeInfo,
    warn: (msg) => writeErr(chalk.yellow(msg)),
    error: (msg) => writeErr(chalk.red(msg)),
    success: (icon, msg) => writeSuccess(`${chalk.green(icon)} ${msg}`),
    bold: (msg) => chalk.bold(msg),
    dim: (msg) => chalk.dim(msg),
    green: (msg) => chalk.green(msg),
    yellow: (msg) => chalk.yellow(msg),
    red: (msg) => chalk.red(msg),
    cyan: (msg) => chalk.cyan(msg),
    blue: (msg) => chalk.blue(msg),
  };
}

export function createSilentLogger(): Logger {
  const identity = (msg: string) => msg;
  return {
    log: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    success: () => {},
    bold: identity,
    dim: identity,
    green: identity,
    yellow: identity,
    red: identity,
    cyan: identity,
    blue: identity,
  };
}
