import type { AgentBrewState } from "./types.js";

/**
 * One-time state-schema migrations for fields that have been removed from
 * `AgentBrewState`.
 *
 * ## Why this file exists
 *
 * Every `delete-*` task in `TASKS.md` that removes a top-level state field
 * (e.g. `delete-team-command` dropped `teamConfig`) needs to:
 *
 *   1. Detect the removed field on an upgraded user's existing `state.yaml`.
 *   2. Print a one-time hint explaining what's gone and what the replacement is.
 *   3. Drop the field on the next `saveState` call.
 *
 * Without a registry the same `(previousState as any).<field>` shape repeats
 * across `init.ts`, with a growing list of `biome-ignore` casts. Per the
 * helper extraction shipped in PR #729: encode the shape once, make adding
 * a new migration a one-line PR.
 *
 * ## How to add a migration
 *
 * Add an entry to the `MIGRATIONS` array below. Each migration declares:
 *
 * - `id` — stable identifier, matches the removal PR's task ID.
 * - `predicate(state)` — returns the value(s) to include in the hint when the
 *   removed field is present, or `undefined` when the field is absent.
 *   Accept the typed `AgentBrewState` and an untyped `unknown` view so the
 *   migration can probe fields TypeScript no longer knows about.
 * - `hint(value)` — renders the user-facing hint given the predicate's return.
 *
 * The migration is self-contained in this file — no edit to `init.ts` needed.
 * Step 3 ("drop on next save") happens automatically: `saveState` serialises
 * the typed state, which never writes unknown fields.
 */

/** Signature every `state-migrations` entry obeys. */
interface StateMigration<T = unknown> {
  /** Stable identifier — matches the removal PR's task ID. */
  id: string;
  /**
   * Probe `previousState` for the removed field. Return the captured value
   * when the field is present; return `undefined` to skip. The untyped
   * `unknown` view is the same object as the typed one — use whichever is
   * convenient.
   */
  predicate: (state: AgentBrewState, untyped: Record<string, unknown>) => T | undefined;
  /** Render a human-facing hint. Multiple console.log lines are OK. */
  hint: (value: T) => string[];
}

/**
 * Registry of active migrations. Entries stay until every reasonable user
 * has seen the hint at least once — then they can be deleted in a separate
 * PR. (No concrete retention rule exists today; revisit if this list grows
 * past ~5 entries.)
 *
 * Currently includes the legacy organization→team migration which runs when a user with
 * `state.organization: true` upgrades to the team-overlay system.
 */
export const MIGRATIONS: StateMigration<unknown>[] = [
  {
    id: "oss-split-implement-team-command",
    predicate: (_state, untyped) => {
      const organizationFlag = untyped.organization;
      // Only migrate if the legacy organization flag is explicitly true.
      if (organizationFlag === true) {
        return true;
      }
      return undefined;
    },
    hint: () => [
      "ℹ️  team overlay migrated to team-overlay system.",
      "   Run `agentbrew team status` to see the current team configuration.",
      "   Use `agentbrew team set <url>` to switch teams or `agentbrew team unset` to disable.",
    ],
  },
];

interface MigrationHint {
  /** Which migration produced the hint. */
  id: string;
  /** Individual lines ready for `console.log`. */
  lines: string[];
}

/**
 * Run every registered migration against `previousState` and collect the hints
 * whose predicate fired. The caller decides where/how to print — this keeps
 * the helper pure and trivially unit-testable.
 *
 * If `previousState` is undefined (first init) this returns an empty array.
 */
export function applySchemaMigrations(previousState: AgentBrewState | undefined): MigrationHint[] {
  if (!previousState) return [];
  const untyped = previousState as unknown as Record<string, unknown>;
  const hints: MigrationHint[] = [];

  for (const migration of MIGRATIONS) {
    const captured = migration.predicate(previousState, untyped);
    if (captured === undefined) continue;
    hints.push({ id: migration.id, lines: migration.hint(captured) });
  }

  return hints;
}

/** Default sink — prints every hint line to stdout. Exposed so init.ts stays one-liner-small. */
export function printMigrationHints(hints: MigrationHint[]): void {
  for (const hint of hints) {
    for (const line of hint.lines) {
      console.log(line);
    }
  }
}
