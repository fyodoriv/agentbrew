import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { SHARED_RULES_PATH } from "../paths.js";
import { loadState, saveState } from "../state.js";
import type { AgentBrewState } from "../types.js";
import { expandHome } from "../utils.js";

export function hashAgentfileRuleBody(body: string): string {
  return createHash("sha256").update(body.trim()).digest("hex");
}

/** Refresh only still-owned bodies across the caller's trusted automatic rewrite. */
export function refreshAgentfileRuleHashesAfterRewrite(state: AgentBrewState, before: string, after: string): boolean {
  const hashes = state.agentfileRuleHashes;
  if (!hashes) return false;
  const bodies = (content: string) =>
    new Map(
      [
        ...content.matchAll(
          /^<!--[ \t]*agentfile-rules:[ \t]*(\S+)[ \t]*-->\r?\n([\s\S]*?)^<!--[ \t]*\/agentfile-rules:[ \t]*\1[ \t]*-->[ \t]*\r?\n?/gm,
        ),
      ].map((match) => [match[1], hashAgentfileRuleBody(match[2])]),
    );
  const previous = bodies(before);
  const rewritten = bodies(after);
  let changed = false;
  for (const [id, hash] of Object.entries(hashes)) {
    const next = rewritten.get(id);
    if (state.agentfileRuleOwners?.[id] && previous.get(id) === hash && next && next !== hash) {
      hashes[id] = next;
      changed = true;
    }
  }
  return changed;
}

/** Absence is ENOENT, never an inaccessible directory or an unreadable volume. */
function checkoutAbsent(path: string): boolean {
  try {
    lstatSync(path);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

/** Track only new or already-owned registrations in the supplied state.yaml snapshot. */
export function recordMemoryPackOwners(
  state: AgentBrewState,
  paths: string[],
  baseDir: string,
  previous: Set<string>,
): boolean {
  const before = JSON.stringify(state.memory?.packOwners);
  const owners = { ...state.memory?.packOwners };
  for (const path of paths) {
    if (previous.has(path) && !owners[path]) continue;
    owners[path] = [...new Set([...(owners[path] ?? []), resolve(baseDir)])];
  }
  if (Object.keys(owners).length) state.memory = { ...state.memory, packOwners: owners };
  return before !== JSON.stringify(state.memory?.packOwners);
}

/** Mutates only this supplied state.yaml snapshot, not any pack's stored data. */
export function pruneStaleAgentfileArtifacts(
  state: AgentBrewState,
  rules: string,
): { content: string; changed: boolean } {
  const before = JSON.stringify(state);
  const owners = state.agentfileRuleOwners ?? {};
  const missing = new Set(
    Object.entries(owners)
      .filter(([, root]) => checkoutAbsent(root))
      .map(([id]) => id),
  );
  const content = rules.replace(
    /^<!--[ \t]*agentfile-rules:[ \t]*(\S+)[ \t]*-->\r?\n([\s\S]*?)^<!--[ \t]*\/agentfile-rules:[ \t]*\1[ \t]*-->[ \t]*\r?\n?/gm,
    (whole, id: string, body: string) => {
      const emptyLegacy = body.split(/\r?\n/).every((line) => !line.trim() || line.trim() === "## Team Rules");
      const unchangedOwned = missing.has(id) && state.agentfileRuleHashes?.[id] === hashAgentfileRuleBody(body);
      return unchangedOwned || emptyLegacy ? "" : whole;
    },
  );
  for (const id of missing) {
    delete owners[id];
    delete state.agentfileRuleHashes?.[id];
  }
  const packOwners = state.memory?.packOwners;
  if (packOwners) {
    const stale = new Set(
      Object.entries(packOwners)
        .filter(([, roots]) => roots.length > 0 && roots.every(checkoutAbsent))
        .map(([path]) => path),
    );
    state.memory = {
      ...state.memory,
      packPaths: state.memory?.packPaths?.filter((path) => !stale.has(path)),
      packOwners: { ...packOwners },
    };
    for (const path of stale) delete state.memory.packOwners?.[path];
  }
  return { content, changed: content !== rules || before !== JSON.stringify(state) };
}

/** Read/write lifecycle: one sync invocation, persisted in the user's state.yaml. */
export function cleanupStaleAgentfileArtifacts(options: {
  dryRun: boolean;
  state?: AgentBrewState;
  save?: (state: AgentBrewState) => void;
}): { changed: boolean; content?: string } {
  const loaded = options.state ?? loadState();
  if (!loaded) return { changed: false };
  const state = options.dryRun ? (JSON.parse(JSON.stringify(loaded)) as AgentBrewState) : loaded;
  const path = expandHome(SHARED_RULES_PATH);
  const rules = existsSync(path) ? readFileSync(path, "utf-8") : "";
  const result = pruneStaleAgentfileArtifacts(state, rules);
  if (result.changed && !options.dryRun) {
    if (result.content !== rules) writeFileAtomicSync(path, result.content, "utf-8");
    (options.save ?? saveState)(state);
  }
  return { changed: result.changed, content: result.content };
}
