import { existsSync } from "node:fs";
import { join } from "node:path";
import { findAgentbrewRepoRoot } from "../core/repo-root.js";

/**
 * True when `name` is a skill shipped in agentbrew's own `skill-plugins/dev/`.
 * Such a name resolves to the built-in copy: installs and source re-indexing
 * never claim it for another source.
 */
export function isBuiltInSkill(name: string): boolean {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return false;
  const root = process.env.AGENTBREW_DIR ?? findAgentbrewRepoRoot("skill-plugins/dev");
  return root !== null && existsSync(join(root, "skill-plugins", "dev", name, "SKILL.md"));
}
