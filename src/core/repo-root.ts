import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expandHome } from "../utils.js";

/** True when `dir` holds a package.json named agentbrew and the `marker` path. */
function isAgentbrewRoot(dir: string, marker: string): boolean {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: string };
    if (pkg.name === "agentbrew") {
      return existsSync(join(dir, marker));
    }
  } catch {
    // ignore malformed package.json
  }
  return false;
}

/**
 * Locate the agentbrew repo root by walking up from this module's path.
 * `marker` is a repo-relative path the caller needs, for example
 * `hooks/manifest.yaml` or `skill-plugins/dev`.
 *
 * Do not compute the root from a fixed number of `..` steps: tsup bundles
 * every module into `dist/cli.js` (one level below the root), while dev runs
 * load `src/<area>/*.ts` (two levels below). The walk-up works for both.
 *
 * Returns null if no ancestor matches; the caller picks a fallback.
 */
export function findAgentbrewRepoRoot(marker: string): string | null {
  let current = dirname(new URL(import.meta.url).pathname);
  const home = expandHome("~");
  for (let i = 0; i < 10; i++) {
    if (isAgentbrewRoot(current, marker)) return current;
    const parent = dirname(current);
    if (parent === current || parent === home || parent === "/") break;
    current = parent;
  }
  return null;
}
