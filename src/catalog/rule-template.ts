import { spawnSync } from "node:child_process";

/**
 * Variables that can be substituted into catalog rule content before it is
 * written to shared-rules.md. Keeping this interface tiny on purpose —
 * each new key should have a strong use case; otherwise rules should be
 * generic enough to skip templating entirely.
 */
export interface TemplateVars {
  user_name: string;
}

interface ResolveUserNameOptions {
  /** Optional environment override (defaults to `process.env`). */
  env?: NodeJS.ProcessEnv;
  /**
   * Result of `git config user.name`. If the key is present (even `undefined`),
   * the git fallback is skipped — this makes the function deterministic in tests
   * without needing to mock `child_process`. If omitted, the real git command
   * is invoked.
   */
  gitName?: string;
}

/** Read `git config user.name` from the host machine. Returns undefined on any failure. */
function readGitName(): string | undefined {
  try {
    const result = spawnSync("git", ["config", "user.name"], { encoding: "utf-8" });
    if (result.status !== 0) return undefined;
    const name = result.stdout?.trim();
    return name ? name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a short display name for rule template substitution.
 *
 * Why the fallback chain: the attribution footer reads best as a first name
 * ("not Fyodor"), so we prefer `git config user.name` and take the first word.
 * When git is unset we degrade gracefully to `$USER`, and finally to a generic
 * "the user" phrase so the footer still reads sensibly on fresh machines.
 *
 * Resolution order:
 * 1. `AGENTBREW_USER_NAME` env override — lets users pick a display name that
 *    differs from their git identity (e.g., handle vs. legal name).
 * 2. First word of `git config user.name`.
 * 3. `$USER` env var.
 * 4. Literal "the user".
 */
function resolveUserName(options: ResolveUserNameOptions = {}): string {
  const env = options.env ?? process.env;
  const gitName = "gitName" in options ? options.gitName : readGitName();

  const override = env.AGENTBREW_USER_NAME?.trim();
  if (override) return override;

  const trimmedGit = gitName?.trim();
  if (trimmedGit) {
    const firstWord = trimmedGit.split(/\s+/)[0];
    if (firstWord) return firstWord;
  }

  const user = env.USER?.trim();
  if (user) return user;

  return "the user";
}

/** Build the `TemplateVars` bundle once so tests and production share the same inputs. */
export function resolveTemplateVars(options: ResolveUserNameOptions = {}): TemplateVars {
  return { user_name: resolveUserName(options) };
}

/**
 * Substitute known `{{ var_name }}` placeholders in rule content.
 *
 * Unknown variables are intentionally left intact (not silently blanked)
 * so catalog typos surface quickly as literal `{{ foo }}` in the deployed
 * rule instead of an invisible empty spot.
 */
export function applyRuleTemplate(content: string, vars: TemplateVars): string {
  return content.replace(/\{\{\s*user_name\s*\}\}/g, vars.user_name);
}
