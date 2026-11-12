/**
 * Keystroke-Level Model (KLM): task time as the sum of small operator times.
 * Card, Moran, Newell 1980, "The Keystroke-Level Model for User Performance
 * Time with Interactive Systems", CACM 23(7).
 *
 * agentbrew uses it to model the time a person needs to do by hand what a sync
 * or a repair does. The numbers are modelled, not timed with people.
 * docs/observability.md ("How much it helps") shows the same tables.
 */

/** Operator times in seconds. K is the average skilled typist (about 55 words per minute), from the 1980 paper. */
export const KLM_SECONDS = {
  /** Press one key. A chord such as Cmd+V is two K. */
  K: 0.2,
  /** Point at a target with the mouse. */
  P: 1.1,
  /** Move a hand between keyboard and mouse. */
  H: 0.4,
  /** Think before a step. */
  M: 1.35,
  /** Press or release the mouse button. A click is B B. */
  B: 0.1,
} as const;

export type KlmOperator = keyof typeof KLM_SECONDS | { R: number };

/** Seconds for one operator. `{ R: t }` is a wait for a system response of t seconds. */
export function operatorSeconds(op: KlmOperator): number {
  return typeof op === "string" ? KLM_SECONDS[op] : op.R;
}

/** Sum an operator sequence, in seconds (rounded to the nearest millisecond, so float noise does not show). */
export function klmSeconds(ops: readonly KlmOperator[]): number {
  return Math.round(ops.reduce((sum, op) => sum + operatorSeconds(op), 0) * 1000) / 1000;
}

/** Repeat one operator n times. */
const times = (n: number, op: KlmOperator): KlmOperator[] => Array.from({ length: n }, () => op);

/**
 * The smallest honest hand procedure to change one entry in a config file that
 * is already open in an editor: decide what is wrong, switch to the file with
 * a shortcut, find the place, click it, paste one block, save.
 * Expert user, no error correction, no time to find the problem or the block.
 */
const EDIT_ONE_ENTRY: readonly KlmOperator[] = [
  "M", // decide what to change
  "K",
  "K", // Cmd+number: switch to the open file
  "M", // find the place
  "P",
  "B",
  "B", // click it
  "K",
  "K", // Cmd+V: paste the block
  "K",
  "K", // Cmd+S: save
];

/** Sync, per agent: copy one finished config change into one agent's config by hand. */
export const SYNC_PER_AGENT_OPS: readonly KlmOperator[] = EDIT_ONE_ENTRY;

/**
 * Repair, per drift item, by drift type that `agentbrew status --fix` repairs
 * (AUTO_FIXABLE_TYPES in src/drift-fixes.ts). A person notices the problem
 * (the first M) but spends no time finding it.
 */
export const REPAIR_OPS: Readonly<Record<string, readonly KlmOperator[]>> = {
  // One entry in one config file, replaced by a pasted block.
  mcp: EDIT_ONE_ENTRY,
  "mcp-bare-placeholder": EDIT_ONE_ENTRY,
  "mcp-catalog-pin": EDIT_ONE_ENTRY,
  "mcp-playwright-isolated": EDIT_ONE_ENTRY,
  "mcp-permissions": EDIT_ONE_ENTRY,
  rules: EDIT_ONE_ENTRY,
  commands: EDIT_ONE_ENTRY,
  hooks: EDIT_ONE_ENTRY,
  instructions: EDIT_ONE_ENTRY,
  agents: EDIT_ONE_ENTRY,
  models: EDIT_ONE_ENTRY,
  // One duplicate paragraph in the rules source: select it with a triple click, delete, save.
  "rules-source": ["M", "K", "K", "M", "P", ...times(6, "B"), "K", "K", "K"],
  // One missing skill link, made in a shell with tab completion: about 20 keys and Return.
  skills: ["M", "H", ...times(21, "K")],
  // One path in a LaunchAgent plist, typed (about 12 keys) instead of pasted; no reload.
  launchagent: ["M", "K", "K", "M", "P", "B", "B", ...times(12, "K"), "K", "K"],
};

/** The lowest modelled seconds over all repaired drift types: the repair estimate may not exceed it. */
export function lowestRepairSeconds(): number {
  return Math.min(...Object.values(REPAIR_OPS).map(klmSeconds));
}
