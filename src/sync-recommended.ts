import { existsSync } from "node:fs";
import { join } from "node:path";
import { AGENTFILE_NAMES } from "./agentfile.js";
import { expandHome } from "./utils.js";

/** The `sync` flags that decide whether the default recommended install runs. */
export interface SyncRecommendedOptions {
  agentfile?: string;
  recommended?: boolean;
  only?: string;
  dryRun?: boolean;
}

interface SyncRecommendedDeps {
  cwd: string;
  globalDir: string;
  exists: (path: string) => boolean;
}

function hasAgentfile(directory: string, exists: (path: string) => boolean): boolean {
  return AGENTFILE_NAMES.some((name) => exists(join(directory, name)));
}

/**
 * Decide whether `agentbrew sync` installs the catalog recommended set.
 *
 * An Agentfile in effect (`--agentfile`, the global Agentfile, or a project
 * Agentfile in cwd) is the source of truth. It asks for the set with its own
 * `recommended: true`, which the Agentfile apply path installs. Without this
 * gate, a plain `sync` re-installed skills that the Agentfile had removed.
 * A machine with no Agentfile keeps the first-run contract: install the set.
 */
export function shouldInstallRecommendedOnSync(
  options: SyncRecommendedOptions,
  deps: SyncRecommendedDeps = {
    cwd: process.cwd(),
    globalDir: expandHome("~/.config/agentbrew"),
    exists: existsSync,
  },
): boolean {
  if (options.only || options.dryRun || options.recommended === false) return false;
  if (options.agentfile) return false;
  if (hasAgentfile(deps.globalDir, deps.exists)) return false;
  if (hasAgentfile(deps.cwd, deps.exists)) return false;
  return true;
}
