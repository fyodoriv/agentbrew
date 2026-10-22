import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { contentHash } from "../manifest.js";
import { COMMANDS_DIR } from "../paths.js";
import { expandHome } from "../utils.js";

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
 * sha256 of every `agentbrew.md` text committed before sync stopped copying
 * built-ins into `~/.config/agentbrew/commands/` (#397, #398, #399, and the
 * first commit of their follow-up). Sync never copies them there now, so this
 * list never grows; `isAgentbrewCopy` also matches the current text. A
 * file with one of these exact contents is agentbrew's own stale copy.
 */
export const SHIPPED_BUILTIN_COPY_HASHES: ReadonlySet<string> = new Set([
  "5aea9cd5864d0ed03e88596af6fe7d9e0cfc67d692a9a3dea2bc33893005d0f7",
  "3479311f0fd39948c9eb35c49fc9df1930fdb1527aa736949b59b45ca81fa69a",
  "8422fabc7bd760b316fa0db664301652901277f433a7890c41c6a449e84af2d2",
  "3c69ca803bef71248033096395fc57e5d01c4a1972e78d70dbbe4de5c6edd2d2",
  "addaf373d6d8116c0b738e20778c7cdf4062916bffe8ffea982fa9038c1fda66",
  "3e7513294fb559270fef357ff159b40acc59eb89549aeffeff85a3626a46bcee",
]);

/** True when `content` is agentbrew's own copy of built-in `name`: a shipped text, or the current one. */
export function isAgentbrewCopy(name: string, content: string): boolean {
  if (SHIPPED_BUILTIN_COPY_HASHES.has(contentHash(content))) return true;
  const dir = builtinCommandsDir();
  return (
    dir !== undefined &&
    existsSync(join(dir, `${name}.md`)) &&
    readFileSync(join(dir, `${name}.md`), "utf-8") === content
  );
}

/** True when the user's commands folder holds their own version of built-in `name`. */
export function userOverridesBuiltin(name: string): boolean {
  const bare = name.replace(/\.md$/, "");
  const path = join(expandHome(COMMANDS_DIR), `${bare}.md`);
  if (!builtinCommandNames().includes(bare) || !existsSync(path)) return false;
  return !isAgentbrewCopy(bare, readFileSync(path, "utf-8"));
}
