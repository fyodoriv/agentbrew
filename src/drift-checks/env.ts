import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { checkEnvHygiene } from "../core/env-sanitize.js";
import type { DriftItem } from "./types.js";

/**
 * Vars that an agent session (e.g. Claude Code) sets in its own child processes.
 * Seeing them in this process env is expected when an agent runs `agentbrew status`.
 */
export const SESSION_ENV_VARS: readonly string[] = ["CLAUDECODE"];

const SHELL_STARTUP_FILES = [
  ".zshenv",
  ".zprofile",
  ".zshrc",
  ".zlogin",
  ".bash_profile",
  ".bashrc",
  ".profile",
  ".config/fish/config.fish",
];

/** Return the startup file (as ~/path) that exports the var, or undefined. */
export function findShellStartupExport(variable: string, home: string = homedir()): string | undefined {
  const pattern = new RegExp(`^\\s*(export\\s+|set\\s+-gx\\s+)?${variable}(=|\\s)`, "m");
  for (const file of SHELL_STARTUP_FILES) {
    const path = join(home, file);
    if (!existsSync(path)) continue;
    try {
      if (pattern.test(readFileSync(path, "utf8"))) return `~/${file}`;
    } catch {
      // Unreadable file: treat as no export.
    }
  }
  return undefined;
}

/** True when the caller looks like an agent session: CLAUDECODE set and no tty. */
export function isAgentSessionCaller(): boolean {
  return Boolean(process.env.CLAUDECODE) && !process.stdout.isTTY;
}

interface EnvHygieneOptions {
  /** Treat session vars as warnings even outside a detected agent session. */
  ignoreSessionEnv?: boolean;
  isAgentSession?: boolean;
  shellStartupExport?: (variable: string) => string | undefined;
}

/**
 * Split env-hygiene findings into drift and session warnings.
 * A session var set only in this process env (agent caller or --ignore-session-env)
 * is a warning. A session var exported by a shell startup file is always drift.
 */
export function classifyEnvHygiene(options: EnvHygieneOptions = {}): {
  drift: DriftItem[];
  sessionWarnings: DriftItem[];
} {
  const isAgentSession = options.isAgentSession ?? isAgentSessionCaller();
  const startupExport = options.shellStartupExport ?? ((variable: string) => findShellStartupExport(variable));
  const drift: DriftItem[] = [];
  const sessionWarnings: DriftItem[] = [];
  for (const warning of checkEnvHygiene()) {
    const item: DriftItem = {
      agent: "shell",
      type: "env-hygiene",
      detail: `${warning.variable} is set — may leak into child agent sessions. Run: eval $(agentbrew env sanitize)`,
    };
    if (!SESSION_ENV_VARS.includes(warning.variable)) {
      drift.push(item);
      continue;
    }
    const exportedBy = startupExport(warning.variable);
    if (exportedBy) {
      drift.push({
        ...item,
        detail: `${warning.variable} is exported by ${exportedBy} — leaks into every agent session. Remove it from that file.`,
      });
    } else if (isAgentSession || options.ignoreSessionEnv) {
      sessionWarnings.push({
        ...item,
        detail: `${warning.variable} is set by the calling agent session (not a shell startup file) — not drift.`,
      });
    } else {
      drift.push(item);
    }
  }
  return { drift, sessionWarnings };
}

/**
 * Detect env vars that could leak across agent boundaries (e.g. ANTHROPIC_MODEL
 * set in the parent shell overrides child agent sessions). These are not
 * auto-fixable — the user must unset them or use `eval $(agentbrew env sanitize)`.
 */
export function checkEnvHygieneDrift(options: EnvHygieneOptions = {}): DriftItem[] {
  return classifyEnvHygiene(options).drift;
}
