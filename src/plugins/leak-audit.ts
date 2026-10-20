/**
 * Core leak audit and telemetry redaction (issue #208, step 10).
 *
 * Plugins ship leak patterns as data (`contributes.leak_patterns`: a YAML
 * list of regexes, or `{ patterns: [...] }`). The audit scans a repo's
 * tracked files and reports file and line, never the matched text. It fails
 * closed: an installed plugin whose patterns cannot be read or compiled is
 * an error, not "no patterns". Patterns should stay inside POSIX ERE, because
 * the perf hook also applies them in bash to redact project names.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { sync as writeFileSync } from "write-file-atomic";
import { readLock } from "../lock.js";
import { readManifest } from "./manifest.js";
import { pluginDir } from "./store.js";

export class LeakPatternError extends Error {
  readonly exitCode = 2;
}

export interface LeakPattern {
  plugin: string;
  source: string;
  regex: RegExp;
}

export interface LeakFinding {
  file: string;
  line: number;
  plugin: string;
}

function patternsOf(name: string): LeakPattern[] {
  const dir = pluginDir(name);
  let rel: unknown;
  try {
    rel = readManifest(dir).contributes?.leak_patterns;
  } catch (e) {
    throw new LeakPatternError(`Plugin ${name}: cannot read its manifest (${e instanceof Error ? e.message : e})`);
  }
  if (typeof rel !== "string") return [];
  let parsed: unknown;
  try {
    parsed = yaml.load(readFileSync(join(dir, rel), "utf-8"));
  } catch (e) {
    throw new LeakPatternError(
      `Plugin ${name}: cannot read leak patterns ${rel} (${e instanceof Error ? e.message : e})`,
    );
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { patterns?: unknown } | null)?.patterns;
  if (!Array.isArray(list)) throw new LeakPatternError(`Plugin ${name}: leak patterns ${rel} is not a list`);
  return list.map((source) => {
    try {
      return { plugin: name, source: String(source), regex: new RegExp(String(source), "i") };
    } catch {
      throw new LeakPatternError(`Plugin ${name}: invalid leak pattern ${JSON.stringify(source)}`);
    }
  });
}

/** Every installed plugin's leak patterns. Throws {@link LeakPatternError} (fail closed). */
export function loadLeakPatterns(): LeakPattern[] {
  return (readLock().plugins ?? []).flatMap((p) => patternsOf(p.name));
}

const MAX_FILE_BYTES = 2_000_000;

/** Tracked text files in `repoDir` that match any plugin leak pattern. */
export function auditRepo(repoDir: string): LeakFinding[] {
  const patterns = loadLeakPatterns();
  if (patterns.length === 0) return [];
  const files = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoDir,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);
  const findings: LeakFinding[] = [];
  for (const file of files) {
    const path = join(repoDir, file);
    if (!existsSync(path) || statSync(path).size > MAX_FILE_BYTES) continue;
    const text = readFileSync(path, "utf-8");
    if (text.includes("\0")) continue;
    text.split("\n").forEach((content, i) => {
      const hit = patterns.find((p) => p.regex.test(content));
      if (hit) findings.push({ file, line: i + 1, plugin: hit.plugin });
    });
  }
  return findings;
}

/** `$XDG_STATE_HOME/agentbrew/redact-patterns.txt`, read by the perf-record hook. */
export function redactPatternsPath(
  stateHome = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"),
): string {
  return join(stateHome, "agentbrew", "redact-patterns.txt");
}

/** Write plugin leak patterns for the perf hook; remove the file when there are none. */
export function writeRedactPatterns(stateHome?: string): void {
  const path = redactPatternsPath(stateHome);
  const sources = [...new Set(loadLeakPatterns().map((p) => p.source))];
  if (sources.length === 0) {
    rmSync(path, { force: true });
    return;
  }
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${sources.join("\n")}\n`, { mode: 0o600 });
}

/** Delete `context-budget-*.json` files older than `days`. Returns how many. */
export function pruneOldMetrics(dir: string, days: number): number {
  if (!existsSync(dir)) return 0;
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  let removed = 0;
  for (const file of readdirSync(dir)) {
    if (!/^context-budget-.*\.json$/.test(file)) continue;
    const path = join(dir, file);
    if (statSync(path).mtimeMs < cutoff) {
      rmSync(path, { force: true });
      removed++;
    }
  }
  return removed;
}
