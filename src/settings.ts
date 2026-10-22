import { existsSync } from "node:fs";
import { defaultState, getStatePath, invalidateState, loadState, saveState } from "./state.js";
import type { AgentBrewState } from "./types.js";

/** One machine-local setting: its key in state.yaml, default, allowed values, and effect. */
interface Setting {
  key: keyof AgentBrewState;
  default: string;
  allowed: readonly string[];
  /** What each value does, in one line. */
  help: string;
  /** When a new value takes effect. */
  appliesOn: string;
}

/**
 * The one table of agentbrew settings. Every value lives in
 * `~/.config/agentbrew/state.yaml`; a key absent there uses its default.
 * `agentbrew config` prints this table with each value's source, and
 * `agentbrew config set <key> <value>` validates and saves one value, so
 * people and agents never edit state.yaml by hand.
 */
export const SETTINGS: readonly Setting[] = [
  {
    key: "claudePermissions",
    default: "manage",
    allowed: ["manage", "keep"],
    help: "manage: sync turns Claude Code permission prompts off. keep: sync leaves your permission settings alone.",
    appliesOn: "the next `agentbrew sync` (keep does not undo what an earlier sync wrote)",
  },
  {
    key: "skillInstallMode",
    default: "auto",
    allowed: ["auto", "delegate", "native"],
    help: "How remote skill sources install. native skips the skills CLI (offline, or a proxy blocks it).",
    appliesOn: "the next `agentbrew install <source>`",
  },
];

/** One row of `agentbrew config`: the value in effect and where it came from. */
export interface SettingRow {
  key: string;
  value: string;
  source: "default" | "state.yaml";
  default: string;
  allowed: readonly string[];
  help: string;
}

export type SetSettingResult =
  | { ok: true; row: SettingRow; appliesOn: string; path: string }
  | { ok: false; error: string; hint: string };

function rowFor(setting: Setting, state: AgentBrewState | undefined): SettingRow {
  const stored = state?.[setting.key];
  const isSet = typeof stored === "string";
  return {
    key: setting.key,
    value: isSet ? stored : setting.default,
    source: isSet ? "state.yaml" : "default",
    default: setting.default,
    allowed: setting.allowed,
    help: setting.help,
  };
}

/** Every setting with the value in effect and its source. Reads state.yaml only. */
export function listSettings(state: AgentBrewState | undefined = loadState()): SettingRow[] {
  return SETTINGS.map((setting) => rowFor(setting, state));
}

/**
 * Validate one setting and save it to state.yaml. Refuses an unknown key, a
 * value outside the allowed list, and a state.yaml that exists but cannot be
 * read (saving over it would lose the rest of the file).
 */
export function setSetting(key: string, value: string): SetSettingResult {
  const setting = SETTINGS.find((s) => s.key === key);
  if (!setting) {
    return {
      ok: false,
      error: `Unknown setting: ${key}`,
      hint: `Settings: ${SETTINGS.map((s) => s.key).join(", ")}. See them with \`agentbrew config\`.`,
    };
  }
  if (!setting.allowed.includes(value)) {
    return {
      ok: false,
      error: `Invalid value for ${key}: ${value}`,
      hint: `Allowed values: ${setting.allowed.join(", ")} (default: ${setting.default}).`,
    };
  }
  const path = getStatePath();
  const state = loadState();
  if (!state && existsSync(path)) {
    return {
      ok: false,
      error: `Cannot read ${path}, so the setting was not saved.`,
      hint: "Fix the file, or run `agentbrew init --force` to reset it.",
    };
  }
  // A missing state.yaml gets a default one; `agentbrew init` keeps the setting later.
  saveState({ ...(state ?? defaultState()), [setting.key]: value } as AgentBrewState);
  // Read the file back: saveState reports a failed write but does not throw.
  invalidateState();
  const saved = loadState();
  if (saved?.[setting.key] !== value) {
    return { ok: false, error: `Could not save ${key} to ${path}.`, hint: "Check disk space and file permissions." };
  }
  return { ok: true, row: rowFor(setting, saved), appliesOn: setting.appliesOn, path };
}
