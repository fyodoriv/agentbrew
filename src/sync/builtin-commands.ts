import { existsSync } from "node:fs";
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
