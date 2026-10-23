import { execFile, execFileSync } from "node:child_process";
import { logSkipped } from "../core/logger.js";
import { resolveGitCloneUrl } from "../git-source-url.js";
import { cacheGitEnv } from "../mcp/git-ref.js";
import type { Source } from "../types.js";
import { expandHome } from "../utils.js";

interface HeadShaCommand {
  args: string[];
  cwd?: string;
  timeout: number;
}

/** The git command that prints a source's HEAD SHA: rev-parse for local, ls-remote for remote. */
function headShaCommand(source: Source): HeadShaCommand {
  if (source.type === "local") return { args: ["rev-parse", "HEAD"], cwd: expandHome(source.url), timeout: 10_000 };
  // Remote: github shorthand or absolute git URL
  return { args: ["ls-remote", resolveGitCloneUrl(source.url, source.type), "HEAD"], timeout: 15_000 };
}

function parseHeadSha(output: string): string | undefined {
  return output.trim().split("\t")[0] || undefined;
}

/** Get the HEAD commit SHA for a git source. */
export function getGitHeadSha(source: Source): string | undefined {
  try {
    const { args, cwd, timeout } = headShaCommand(source);
    const output = execFileSync("git", args, {
      ...(cwd ? { cwd } : {}),
      env: cacheGitEnv(),
      encoding: "utf-8",
      stdio: "pipe",
      timeout,
    });
    return parseHeadSha(output.toString());
  } catch (e) {
    logSkipped("skills/skill-versions/split", e);
    return undefined;
  }
}

function getGitHeadShaAsync(source: Source, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  return new Promise((resolveSha) => {
    try {
      const { args, cwd, timeout } = headShaCommand(source);
      execFile("git", args, { ...(cwd ? { cwd } : {}), env, encoding: "utf-8", timeout }, (error, stdout) => {
        if (error) {
          logSkipped("skills/skill-versions/split", error);
          resolveSha(undefined);
        } else {
          resolveSha(parseHeadSha(String(stdout)));
        }
      });
    } catch (e) {
      logSkipped("skills/skill-versions/split", e);
      resolveSha(undefined);
    }
  });
}

/** Most remote SHA lookups `recordSourceShas` runs at once. */
const SHA_LOOKUP_CONCURRENCY = 8;

/**
 * Record the current commit SHA of every source, with up to
 * SHA_LOOKUP_CONCURRENCY lookups at once (one `git ls-remote` each takes a
 * network round trip). Returns the SHAs found in this call, keyed by source
 * URL, so later steps in the same run (the lock update) need not ask again.
 */
export async function recordSourceShas(sources: Source[]): Promise<Map<string, string>> {
  const shas = new Map<string, string>();
  // A local source's SHA must come from its own folder, not from the repo a
  // git hook's GIT_DIR points at.
  const env = cacheGitEnv();
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < sources.length) {
      const source = sources[next++] as Source;
      const sha = await getGitHeadShaAsync(source, env);
      if (sha) {
        source.commitSha = sha;
        shas.set(source.url, sha);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SHA_LOOKUP_CONCURRENCY, sources.length) }, worker));
  return shas;
}

/** Record the current commit SHA for a source. */
export function recordSourceSha(source: Source): void {
  const sha = getGitHeadSha(source);
  if (sha) {
    source.commitSha = sha;
  }
}
