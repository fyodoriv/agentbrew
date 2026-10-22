import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Commands that ship inside the agentbrew package, such as /agentbrew. Sync
 * deploys them with no Agentfile line, the way built-in skills ship. A
 * checkout keeps them in `commands/`; the npm bundle in `dist/commands/`
 * (tsup copies it). Undefined when neither exists.
 */
export function builtinCommandsDir(): string | undefined {
  const candidates = [join(import.meta.dirname, "commands"), join(import.meta.dirname, "..", "..", "commands")];
  return candidates.find((dir) => existsSync(join(dir, "agentbrew.md")));
}

/** Names of the built-in commands, without `.md`. */
export function builtinCommandNames(): string[] {
  const dir = builtinCommandsDir();
  if (!dir) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.slice(0, -3));
}

/**
 * sha256 of every `agentbrew.md` that agentbrew 0.x copied into
 * `~/.config/agentbrew/commands/` itself (#397, #398, #399). Sync no longer
 * copies built-ins there, so this list never grows. A file with one of these
 * exact contents is agentbrew's own stale copy, not the user's edit.
 */
export const SHIPPED_BUILTIN_COPY_HASHES: ReadonlySet<string> = new Set([
  "5aea9cd5864d0ed03e88596af6fe7d9e0cfc67d692a9a3dea2bc33893005d0f7",
  "3479311f0fd39948c9eb35c49fc9df1930fdb1527aa736949b59b45ca81fa69a",
  "addaf373d6d8116c0b738e20778c7cdf4062916bffe8ffea982fa9038c1fda66",
]);
