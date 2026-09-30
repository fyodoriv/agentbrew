import { execFileSync } from "node:child_process";
import { logSkipped } from "../core/logger.js";
import { resolveGitCloneUrl } from "../git-source-url.js";
import type { Source } from "../types.js";
import { expandHome } from "../utils.js";

/** Get the HEAD commit SHA for a git source. */
export function getGitHeadSha(source: Source): string | undefined {
  try {
    if (source.type === "local") {
      const expanded = expandHome(source.url);
      return execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: expanded,
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 10_000,
      })
        .toString()
        .trim();
    }

    // Remote: github shorthand or absolute git URL
    const url = resolveGitCloneUrl(source.url, source.type);

    const output = execFileSync("git", ["ls-remote", url, "HEAD"], {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 15_000,
    })
      .toString()
      .trim();

    const sha = output.split("\t")[0];
    return sha || undefined;
  } catch (e) {
    logSkipped("skills/skill-versions/split", e);
    return undefined;
  }
}

/** Record the current commit SHA for a source. */
export function recordSourceSha(source: Source): void {
  const sha = getGitHeadSha(source);
  if (sha) {
    source.commitSha = sha;
  }
}
