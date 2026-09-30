import type { Source } from "./types.js";

const GITHUB_SHORTHAND_RE = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/;

export function isGithubShorthand(source: string): boolean {
  return GITHUB_SHORTHAND_RE.test(source);
}

export function isAbsoluteGitRemote(source: string): boolean {
  return (
    source.startsWith("git@") ||
    source.startsWith("http://") ||
    source.startsWith("https://") ||
    source.startsWith("ssh://")
  );
}

export function detectSourceType(source: string): Source["type"] {
  if (source.startsWith("/") || source.startsWith("~") || source.startsWith("./")) {
    return "local";
  }
  if (isAbsoluteGitRemote(source)) {
    return "url";
  }
  if (isGithubShorthand(source)) {
    return "github";
  }
  return "url";
}

/** Resolve the URL passed to `git clone` / `git ls-remote` for a tracked source. */
export function resolveGitCloneUrl(url: string, type?: Source["type"]): string {
  const effectiveType = type ?? detectSourceType(url);
  if (effectiveType === "github" && isGithubShorthand(url)) {
    const normalized = url.endsWith(".git") ? url.slice(0, -4) : url;
    return `https://github.com/${normalized}.git`;
  }
  return url;
}
