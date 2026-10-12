import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { CATALOG_RULE_HASHES_PATH } from "../paths.js";
import { expandHome } from "../utils.js";

/** Hash of a rule body with trailing whitespace ignored. */
export function hashRuleBody(body: string): string {
  return createHash("sha256").update(body.trimEnd()).digest("hex");
}

/**
 * Hashes of catalog rule bodies agentbrew wrote into shared-rules.md.
 * Owner: this module. Lifecycle: one JSON file, written on install and refresh,
 * deleted never (a stale entry only makes refresh more cautious).
 */
export function readRuleHashes(): Record<string, string> {
  const path = expandHome(CATALOG_RULE_HASHES_PATH);
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function recordRuleHash(name: string, body: string): void {
  const path = expandHome(CATALOG_RULE_HASHES_PATH);
  const hashes = { ...readRuleHashes(), [name]: hashRuleBody(body) };
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomicSync(path, `${JSON.stringify(hashes, null, 2)}\n`, "utf-8");
}
