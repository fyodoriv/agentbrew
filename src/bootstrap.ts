import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import chalk from "chalk";
import { getSourceCachePath } from "./catalog/index-source.js";
import { errorMessage } from "./core/errors.js";
import { requireState } from "./state.js";
import type { Source } from "./types.js";
import { ICON_SUCCESS } from "./ui/output.js";

interface BootstrapOptions {
  dryRun?: boolean;
}

function sourceShortName(source: Source): string {
  return basename(source.url.replace(/\.git$/, ""));
}

function matchingSources(sources: Source[], sourceName: string): Source[] {
  const exact = sources.find((source) => source.url === sourceName);
  if (exact) return [exact];
  return sources.filter((source) => sourceShortName(source) === sourceName);
}

function resolveBootstrapScript(cachePath: string, bootstrapScript: string): string {
  if (isAbsolute(bootstrapScript)) return bootstrapScript;
  return resolve(cachePath, bootstrapScript);
}

export function bootstrapSource(sourceName: string, options: BootstrapOptions = {}): boolean {
  const state = requireState();
  if (!state) return false;

  const sources = matchingSources(state.sources ?? [], sourceName);
  if (sources.length === 0) {
    console.error(chalk.red(`Source '${sourceName}' not found.`));
    process.exitCode = 1;
    return false;
  }
  if (sources.length > 1) {
    console.error(chalk.red(`Source '${sourceName}' is ambiguous. Use the full source URL.`));
    process.exitCode = 1;
    return false;
  }

  const source = sources[0];
  if (!source.bootstrapScript) {
    console.error(chalk.yellow(`Source '${source.url}' does not declare a bootstrap script.`));
    process.exitCode = 1;
    return false;
  }

  const cachePath = getSourceCachePath(source);
  if (!cachePath) {
    console.error(chalk.red(`Could not access source cache for '${source.url}'.`));
    process.exitCode = 1;
    return false;
  }

  const scriptPath = resolveBootstrapScript(cachePath, source.bootstrapScript);
  if (!existsSync(scriptPath)) {
    console.error(chalk.red(`Bootstrap script not found: ${scriptPath}`));
    process.exitCode = 1;
    return false;
  }

  if (options.dryRun) {
    console.log(chalk.dim(`Would run bootstrap script for ${source.url}: ${scriptPath}`));
    return true;
  }

  try {
    execFileSync("bash", [scriptPath], { cwd: cachePath, stdio: "inherit", timeout: 600_000 });
  } catch (error) {
    console.error(chalk.red(`Bootstrap failed for '${source.url}': ${errorMessage(error)}`));
    process.exitCode = 1;
    return false;
  }
  console.log(`${ICON_SUCCESS} Bootstrap complete: ${source.url}`);
  return true;
}
