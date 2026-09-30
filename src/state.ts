import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import chalk from "chalk";
import yaml from "js-yaml";
import { sync as writeFileSync } from "write-file-atomic";
import { errorMessage } from "./core/errors.js";
import { logSkipped } from "./core/logger.js";
import type { StateIO, StateManager } from "./core/state-manager.js";
import {
  createInMemoryStateManager,
  getStateManager,
  initStateManager,
  replaceStateManager,
} from "./core/state-manager.js";
import type { AgentBrewState } from "./types.js";

const STATE_DIR = join(homedir(), ".config", "agentbrew");
const STATE_FILE = join(STATE_DIR, "state.yaml");

export function getStatePath(): string {
  return STATE_FILE;
}

export function defaultState(): AgentBrewState {
  return {
    schemaVersion: 1,
    agents: [],
    catalogVersion: "0.1.0",
  };
}

const diskIO: StateIO = {
  read(): AgentBrewState | undefined {
    if (!existsSync(STATE_FILE)) return undefined;
    try {
      const content = readFileSync(STATE_FILE, "utf-8");
      return yaml.load(content) as AgentBrewState;
    } catch (error) {
      const reason = errorMessage(error);
      console.error(chalk.red(`\n✗ state.yaml is corrupted: ${reason}`));
      console.error(chalk.dim(`  File: ${STATE_FILE}`));
      console.error(chalk.dim(`  Run ${chalk.white("agentbrew init --force")} to reset.\n`));
      process.exitCode = 1;
      return undefined;
    }
  },

  write(state: AgentBrewState): void {
    try {
      mkdirSync(dirname(STATE_FILE), { recursive: true });
      if (existsSync(STATE_FILE)) {
        copyFileSync(STATE_FILE, `${STATE_FILE}.bak`);
      }
      // Strip non-serializable values (functions, symbols, undefined) before YAML
      // serialization. AgentConfig.commandTransform is a Function at runtime and
      // js-yaml throws "unacceptable kind of an object to dump [object Function]"
      // if it reaches yaml.dump(). JSON.stringify safely drops these.
      const sanitized = JSON.parse(JSON.stringify(state));
      const content = yaml.dump(sanitized, {
        lineWidth: 120,
        noRefs: true,
        sortKeys: false,
      });
      writeFileSync(STATE_FILE, content, "utf-8");
      chmodSync(STATE_FILE, 0o600);
    } catch (error) {
      const reason = errorMessage(error);
      console.error(chalk.red(`\n✗ Failed to write state.yaml: ${reason}`));
      console.error(chalk.dim(`  File: ${STATE_FILE}`));
      console.error(chalk.dim(`  Check disk space and file permissions.\n`));
      process.exitCode = 1;
    }
  },
};

/** Test-only export — diskIO tests need direct access without going through the singleton. */
export const stateModuleDiskIO: StateIO = diskIO;

function ensureSingleton(): StateManager {
  try {
    return getStateManager();
  } catch (e) {
    logSkipped("state/getStateManager", e);
    return initStateManager(diskIO);
  }
}

export function loadState(): AgentBrewState | undefined {
  return ensureSingleton().load();
}

export function requireState(options?: { quiet?: boolean }): AgentBrewState | undefined {
  return ensureSingleton().require(options);
}

export function saveState(state: AgentBrewState): void {
  ensureSingleton().save(state);
}

export function invalidateState(): void {
  ensureSingleton().invalidate();
}

export async function withStateOverride<T>(state: AgentBrewState | undefined, fn: () => Promise<T>): Promise<T> {
  if (!state) return fn();

  const previous = replaceStateManager(createInMemoryStateManager(state));
  try {
    return await fn();
  } finally {
    replaceStateManager(previous);
  }
}
