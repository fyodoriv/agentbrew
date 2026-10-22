/**
 * Repo scoping for plugin rules (issue #208, step 7).
 *
 * A repo is identified by its `origin` remote as `host/path` (lower case, no
 * scheme, user, port, or `.git`). A plugin's rules apply only in repos that
 * match `capabilities.repos.include` and not `exclude`. The default is
 * nowhere. Public hosts are always excluded unless an include pattern names
 * that host explicitly.
 */
import { execFileSync } from "node:child_process";

export const PUBLIC_HOSTS = ["github.com", "gitlab.com", "bitbucket.org", "codeberg.org"];

export interface RepoScope {
  include?: string[];
  exclude?: string[];
}

/** `git@host:a/b.git`, `https://u@host:443/a/b/` → `host/a/b`. */
export function normalizeRemote(url: string): string {
  let rest = url.trim().toLowerCase();
  rest = rest.replace(/^[a-z+]+:\/\//, "");
  rest = rest.replace(/^[^@/]+@/, "");
  rest = rest.replace(/^([^/:]+):\d+\//, "$1/");
  rest = rest.replace(/^([^/:]+):/, "$1/");
  return rest.replace(/\.git\/?$/, "").replace(/\/+$/, "");
}

/** The repo id of the checkout at `dir`, or undefined when it has no origin. */
export function repoIdOf(dir: string): string | undefined {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], { cwd: dir, encoding: "utf-8", stdio: "pipe" });
    return normalizeRemote(url);
  } catch {
    return undefined;
  }
}

function globToRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string;
    if (c === "*" && pattern[i + 1] === "*") {
      out += ".*";
      i++;
    } else if (c === "*") {
      out += "[^/]*";
    } else {
      out += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

function matchesAny(id: string, patterns: string[]): boolean {
  return patterns.some((p) => globToRegExp(p.toLowerCase()).test(id));
}

/** True when plugin rules may apply in repo `id`. */
export function repoAllowed(id: string | undefined, scope: RepoScope | undefined): boolean {
  if (!id) return false;
  const include = scope?.include ?? [];
  if (!matchesAny(id, include)) return false;
  if (matchesAny(id, scope?.exclude ?? [])) return false;
  const host = id.split("/")[0] as string;
  if (PUBLIC_HOSTS.includes(host)) {
    return include.some((p) => p.toLowerCase().startsWith(`${host}/`) && globToRegExp(p.toLowerCase()).test(id));
  }
  return true;
}
