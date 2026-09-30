/**
 * `agentbrew classify <repo-path>` — classify a repo as solo or shared so
 * downstream tools (minsky, safe-admin-merge, etc.) can scale
 * safety guards by repo class.
 *
 * Source: 2026-04-27 user incident — `safe-admin-merge.sh` blocked an admin
 * merge with "13/5 in the rolling 24h window" on the user's own personal
 * grind run. The rate-limit guard was extracted from a real risk surface
 * (organization shared-master) but fires the same way against solo personal
 * repos. agentbrew now classifies the repo so the guard can adapt.
 *
 * Usage:
 *   agentbrew classify <repo-path>             # Print "solo" or "shared".
 *   agentbrew classify <repo-path> --set solo  # Write override.
 *   agentbrew classify <repo-path> --set shared
 *   agentbrew classify <repo-path> --unset     # Remove override.
 */

import { resolve } from "node:path";
import type { Command } from "commander";
import { getRepoClass, setRepoClass, unsetRepoClass } from "../repo-class.js";

interface ClassifyOptions {
  set?: "solo" | "shared";
  unset?: boolean;
}

/** Register the `classify` command on the program. */
export function registerClassifyCommand(program: Command): void {
  // Visible in the "Advanced" help group (not hidden) per
  // `harden-user-story-cli-reference-invariant`: README.md (line 278) and
  // VISION.md (line 47) both document `agentbrew classify <repo-path>` as
  // a CLI command users invoke directly, even though the primary consumers
  // are downstream tools (minsky, safe-admin-merge). The
  // "Advanced" group placement signals "not part of the primary flow"
  // without lying about whether the command exists.
  program
    .command("classify <repo-path>")
    .description("Classify a repo as solo or shared (downstream safety-rail input)")
    .option("--set <class>", "Write an explicit override (solo or shared)")
    .option("--unset", "Remove the override and revert to auto-detection")
    .action((repoPath: string, options: ClassifyOptions) => {
      runClassify(repoPath, options);
    });
}

/** Pure command body — separated for testability. */
export function runClassify(repoPath: string, options: ClassifyOptions): void {
  const absolute = resolve(repoPath);
  if (options.unset) {
    unsetRepoClass(absolute);
    process.stdout.write(`Override removed for ${absolute}\n`);
    return;
  }
  if (options.set !== undefined) {
    if (options.set !== "solo" && options.set !== "shared") {
      process.stderr.write(`Invalid class: ${options.set}. Must be "solo" or "shared".\n`);
      process.exitCode = 1;
      return;
    }
    setRepoClass(absolute, options.set);
    process.stdout.write(`${absolute}: ${options.set} (override)\n`);
    return;
  }
  // Read mode: print classification to stdout.
  const klass = getRepoClass(absolute);
  process.stdout.write(`${klass}\n`);
}
