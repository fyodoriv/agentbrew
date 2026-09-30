import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

import { resolveGitCloneUrl } from "../git-source-url.js";
import { expandHome } from "../utils.js";

export const STAGE_VERSION = 3 as const;

const HARVEST_MARKDOWN = ["README.md", "AGENTS.md", "ARCHITECTURE.md", "VISION.md", "MILESTONES.md"] as const;
const SKIP_TREE_NAMES = new Set(["node_modules", ".git", "dist"]);

export interface StageDocInput {
  title: string;
  sourcePath: string;
}

export interface StageContextInput {
  name: string;
  sourcePath: string;
}

/** Loose local file (PDF/MD/TXT/HTML/…) copied verbatim, extension preserved. */
export interface StageFileInput {
  label: string;
  sourcePath: string;
}

/** Web page the agent already fetched to a local markdown file. */
export interface StageWebInput {
  url: string;
  sourcePath: string;
}

export interface StageLearnSourcesOptions {
  outputDir: string;
  repos?: readonly string[];
  localRepos?: readonly string[];
  docs?: readonly StageDocInput[];
  files?: readonly StageFileInput[];
  web?: readonly StageWebInput[];
  context?: readonly StageContextInput[];
  depth?: number;
  dryRun?: boolean;
}

export interface StagedRepo {
  name: string;
  path: string;
  source: string;
  kind: "clone" | "local";
  sourceKey: string;
  contentHash: string;
}

export interface StagedDoc {
  title: string;
  path: string;
  sourceFile: string;
  sourceKey: string;
  contentHash: string;
}

export interface StagedContext {
  name: string;
  path: string;
  sourceFile: string;
  sourceKey: string;
  contentHash: string;
}

export interface StagedFile {
  label: string;
  path: string;
  sourceFile: string;
  sourceKey: string;
  contentHash: string;
}

export interface StagedWeb {
  url: string;
  path: string;
  sourceFile: string;
  sourceKey: string;
  contentHash: string;
}

export type TutorSetupMode = "codebase" | "document" | "mixed";

/** Per-source incremental staging summary (v3+). */
export interface SourceFreshness {
  changed: string[];
  unchanged: string[];
}

export interface StageManifest {
  version: typeof STAGE_VERSION;
  createdAt: string;
  outputDir: string;
  repos: StagedRepo[];
  docs: StagedDoc[];
  files: StagedFile[];
  web: StagedWeb[];
  context: StagedContext[];
  tutorSetupMode: TutorSetupMode;
  tutorSetupCwd: string;
  instructions: string;
  freshness: SourceFreshness;
}

/** Kebab-case directory name safe for staging paths. */
export function sanitizeDirName(name: string): string {
  return name
    .replace(/\.git$/i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/** Repo folder name from owner/repo, URL, or local path. */
export function resolveRepoName(spec: string): string {
  const trimmed = spec.trim().replace(/\/$/, "");
  if (trimmed.includes("/") && !trimmed.startsWith("/") && !trimmed.startsWith("~")) {
    const parts = trimmed.split("/");
    const last = parts[parts.length - 1] ?? trimmed;
    return sanitizeDirName(last.replace(/\.git$/, ""));
  }
  return sanitizeDirName(basename(trimmed));
}

function ensureDir(path: string, dryRun: boolean): void {
  if (dryRun || existsSync(path)) return;
  mkdirSync(path, { recursive: true });
}

/** SHA-256 of a single source file (inputs gathered before staging). */
export function hashSourceFile(sourcePath: string): string {
  const resolved = resolve(expandHome(sourcePath));
  if (!existsSync(resolved)) {
    throw new Error(`Source file not found: ${resolved}`);
  }
  return createHash("sha256").update(readFileSync(resolved)).digest("hex");
}

function listRelativeFiles(root: string, relative = ""): string[] {
  const dir = relative ? join(root, relative) : root;
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !SKIP_TREE_NAMES.has(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const files: string[] = [];
  for (const entry of entries) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...listRelativeFiles(root, rel));
      continue;
    }
    if (entry.isFile()) {
      files.push(rel);
    }
  }
  return files;
}

/** SHA-256 over sorted relative paths + file contents (local repos). */
export function hashSourceDirectory(sourcePath: string): string {
  const resolved = resolve(expandHome(sourcePath));
  const hash = createHash("sha256");
  for (const rel of listRelativeFiles(resolved)) {
    hash.update(rel);
    hash.update(readFileSync(join(resolved, rel)));
  }
  return hash.digest("hex");
}

function loadPreviousManifest(outputDir: string): StageManifest | null {
  const manifestPath = join(outputDir, "manifest.json");
  if (!existsSync(manifestPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as StageManifest;
    return parsed.version === STAGE_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

/** Map stable sourceKey → contentHash from a prior manifest. */
export function indexPreviousHashes(manifest: StageManifest | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!manifest) return map;
  for (const item of [...manifest.repos, ...manifest.docs, ...manifest.files, ...manifest.web, ...manifest.context]) {
    if (item.sourceKey && item.contentHash) {
      map.set(item.sourceKey, item.contentHash);
    }
  }
  return map;
}

function recordFreshness(
  freshness: SourceFreshness,
  sourceKey: string,
  contentHash: string,
  previous: Map<string, string>,
): boolean {
  const unchanged = previous.get(sourceKey) === contentHash;
  (unchanged ? freshness.unchanged : freshness.changed).push(sourceKey);
  return unchanged;
}

function runGitClone(spec: string, destination: string, depth: number, dryRun: boolean): void {
  const url = resolveGitCloneUrl(spec);
  if (dryRun) return;
  const parent = join(destination, "..");
  ensureDir(parent, false);
  const result = spawnSync("git", ["clone", "--depth", String(depth), "--single-branch", url, destination], {
    stdio: "pipe",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`git clone failed for ${spec}: ${detail}`);
  }
}

function copyTree(source: string, destination: string, dryRun: boolean): void {
  if (dryRun) return;
  ensureDir(join(destination, ".."), false);
  cpSync(source, destination, {
    recursive: true,
    filter: (src) => {
      const base = basename(src);
      return base !== "node_modules" && base !== ".git" && base !== "dist";
    },
  });
}

function copyMarkdownFile(sourcePath: string, destination: string, dryRun: boolean): void {
  const resolved = resolve(expandHome(sourcePath));
  if (!existsSync(resolved)) {
    throw new Error(`Source file not found: ${resolved}`);
  }
  if (dryRun) return;
  ensureDir(join(destination, ".."), false);
  copyFileSync(resolved, destination);
}

/** Original file extension (lowercased, incl. dot) or empty string. */
function sourceExtension(sourcePath: string): string {
  return extname(sourcePath).toLowerCase();
}

function harvestRepoMarkdown(repoPath: string, repoName: string, docsDir: string, dryRun: boolean): void {
  const harvestDir = join(docsDir, "repos", repoName);
  for (const filename of HARVEST_MARKDOWN) {
    const source = join(repoPath, filename);
    if (!existsSync(source)) continue;
    const dest = join(harvestDir, filename);
    copyMarkdownFile(source, dest, dryRun);
  }
}

function inferTutorSetupMode(
  repos: StagedRepo[],
  documentCount: number,
): {
  mode: TutorSetupMode;
  cwd: string;
  instructions: string;
} {
  const outputDirPlaceholder = "{outputDir}";
  if (repos.length === 1 && documentCount === 0) {
    return {
      mode: "codebase",
      cwd: join(outputDirPlaceholder, "sources", "repos", repos[0].name),
      instructions:
        "Single codebase source. cd to tutorSetupCwd and run /tutor-setup (Codebase Mode). Then run /tutor against the generated StudyVault.",
    };
  }
  if (repos.length === 0 && documentCount > 0) {
    return {
      mode: "document",
      cwd: join(outputDirPlaceholder, "sources"),
      instructions:
        "Document-only sources (docs/files/web). cd to tutorSetupCwd and run /tutor-setup (Document Mode). Then run /tutor against the generated StudyVault.",
    };
  }
  return {
    mode: "mixed",
    cwd: join(outputDirPlaceholder, "sources"),
    instructions:
      "Mixed sources staged. Option A (recommended): cd to tutorSetupCwd and run /tutor-setup in Document Mode — harvested repo README/AGENTS/ARCHITECTURE/VISION live under docs/repos/<name>/, exported Google Docs under docs/, loose files under files/, and fetched web pages under web/. Option B: run /tutor-setup per repo subdirectory under sources/repos/<name>/ for deeper codebase vaults, then merge dashboards manually.",
  };
}

interface StageReposContext {
  reposDir: string;
  docsDir: string;
  depth: number;
  dryRun: boolean;
  previous: Map<string, string>;
  freshness: SourceFreshness;
}

function stageRepos(options: StageLearnSourcesOptions, context: StageReposContext): StagedRepo[] {
  const { reposDir, docsDir, depth, dryRun, previous, freshness } = context;
  const repos: StagedRepo[] = [];

  for (const spec of options.repos ?? []) {
    const name = resolveRepoName(spec);
    const dest = join(reposDir, name);
    const sourceKey = `repo:${name}`;
    runGitClone(spec, dest, depth, dryRun);
    const contentHash = dryRun ? `dry-run:${spec}` : hashSourceDirectory(dest);
    recordFreshness(freshness, sourceKey, contentHash, previous);
    if (!dryRun && existsSync(dest)) {
      harvestRepoMarkdown(dest, name, docsDir, dryRun);
    }
    repos.push({ name, path: `sources/repos/${name}`, source: spec, kind: "clone", sourceKey, contentHash });
  }

  for (const local of options.localRepos ?? []) {
    const resolved = resolve(expandHome(local));
    const name = resolveRepoName(resolved);
    const dest = join(reposDir, name);
    const sourceKey = `repo:${name}`;
    const contentHash = hashSourceDirectory(resolved);
    const skipCopy = recordFreshness(freshness, sourceKey, contentHash, previous) && existsSync(dest);
    if (!skipCopy) {
      copyTree(resolved, dest, dryRun);
    }
    if (!dryRun && existsSync(dest)) {
      harvestRepoMarkdown(dest, name, docsDir, dryRun);
    }
    repos.push({
      name,
      path: `sources/repos/${name}`,
      source: resolved,
      kind: "local",
      sourceKey,
      contentHash,
    });
  }

  return repos;
}

function stageDocs(
  inputs: readonly StageDocInput[],
  docsDir: string,
  dryRun: boolean,
  previous: Map<string, string>,
  freshness: SourceFreshness,
): StagedDoc[] {
  return inputs.map((doc) => {
    const filename = `${sanitizeDirName(doc.title)}.md`;
    const dest = join(docsDir, filename);
    const sourceKey = `doc:${sanitizeDirName(doc.title)}`;
    const contentHash = hashSourceFile(doc.sourcePath);
    const skipCopy = recordFreshness(freshness, sourceKey, contentHash, previous) && existsSync(dest);
    if (!skipCopy) {
      copyMarkdownFile(doc.sourcePath, dest, dryRun);
    }
    return {
      title: doc.title,
      path: `sources/docs/${filename}`,
      sourceFile: doc.sourcePath,
      sourceKey,
      contentHash,
    };
  });
}

function stageFiles(
  inputs: readonly StageFileInput[],
  filesDir: string,
  dryRun: boolean,
  previous: Map<string, string>,
  freshness: SourceFreshness,
): StagedFile[] {
  return inputs.map((file) => {
    const filename = `${sanitizeDirName(file.label)}${sourceExtension(file.sourcePath)}`;
    const dest = join(filesDir, filename);
    const sourceKey = `file:${sanitizeDirName(file.label)}`;
    const contentHash = hashSourceFile(file.sourcePath);
    const skipCopy = recordFreshness(freshness, sourceKey, contentHash, previous) && existsSync(dest);
    if (!skipCopy) {
      copyMarkdownFile(file.sourcePath, dest, dryRun);
    }
    return {
      label: file.label,
      path: `sources/files/${filename}`,
      sourceFile: file.sourcePath,
      sourceKey,
      contentHash,
    };
  });
}

function stageWeb(
  inputs: readonly StageWebInput[],
  webDir: string,
  dryRun: boolean,
  previous: Map<string, string>,
  freshness: SourceFreshness,
): StagedWeb[] {
  return inputs.map((page) => {
    const filename = `${sanitizeDirName(page.url)}.md`;
    const dest = join(webDir, filename);
    const sourceKey = `web:${sanitizeDirName(page.url)}`;
    const contentHash = hashSourceFile(page.sourcePath);
    const skipCopy = recordFreshness(freshness, sourceKey, contentHash, previous) && existsSync(dest);
    if (!skipCopy) {
      copyMarkdownFile(page.sourcePath, dest, dryRun);
    }
    return {
      url: page.url,
      path: `sources/web/${filename}`,
      sourceFile: page.sourcePath,
      sourceKey,
      contentHash,
    };
  });
}

function stageContext(
  inputs: readonly StageContextInput[],
  contextDir: string,
  dryRun: boolean,
  previous: Map<string, string>,
  freshness: SourceFreshness,
): StagedContext[] {
  return inputs.map((item) => {
    const filename = `${sanitizeDirName(item.name)}.md`;
    const dest = join(contextDir, filename);
    const sourceKey = `context:${sanitizeDirName(item.name)}`;
    const contentHash = hashSourceFile(item.sourcePath);
    const skipCopy = recordFreshness(freshness, sourceKey, contentHash, previous) && existsSync(dest);
    if (!skipCopy) {
      copyMarkdownFile(item.sourcePath, dest, dryRun);
    }
    return {
      name: item.name,
      path: `sources/context/${filename}`,
      sourceFile: item.sourcePath,
      sourceKey,
      contentHash,
    };
  });
}

function bullets<T>(items: readonly T[], render: (item: T) => string): string[] {
  return items.length > 0 ? items.map(render) : ["- (none)"];
}

function renderSummary(manifest: StageManifest): string {
  return [
    "# Learn Project — Staged Sources",
    "",
    "This folder was produced by `stage-learn-sources` for `/tutor-setup`.",
    "",
    `- **Mode**: ${manifest.tutorSetupMode}`,
    `- **Run tutor-setup from**: \`${manifest.tutorSetupCwd}\``,
    "",
    "## Repos",
    ...bullets(manifest.repos, (r) => `- ${r.name} (${r.source})`),
    "",
    "## Docs",
    ...bullets(manifest.docs, (d) => `- ${d.title}`),
    "",
    "## Files",
    ...bullets(manifest.files, (f) => `- ${f.label}`),
    "",
    "## Web",
    ...bullets(manifest.web, (w) => `- ${w.url}`),
    "",
    "## Context",
    ...bullets(manifest.context, (c) => `- ${c.name}`),
    "",
    "## Freshness",
    `- **Changed**: ${manifest.freshness.changed.length > 0 ? manifest.freshness.changed.join(", ") : "(none)"}`,
    `- **Unchanged**: ${manifest.freshness.unchanged.length > 0 ? manifest.freshness.unchanged.join(", ") : "(none)"}`,
    "",
    manifest.instructions,
    "",
  ].join("\n");
}

/** Stage repos, docs, files, web pages, and optional context into a tutor-setup-ready directory. */
export function stageLearnSources(options: StageLearnSourcesOptions): StageManifest {
  const outputDir = resolve(expandHome(options.outputDir));
  const depth = options.depth ?? 1;
  const dryRun = options.dryRun ?? false;
  const sourcesDir = join(outputDir, "sources");
  const reposDir = join(sourcesDir, "repos");
  const docsDir = join(sourcesDir, "docs");
  const filesDir = join(sourcesDir, "files");
  const webDir = join(sourcesDir, "web");
  const contextDir = join(sourcesDir, "context");

  for (const dir of [reposDir, docsDir, filesDir, webDir, contextDir]) {
    ensureDir(dir, dryRun);
  }

  const previous = indexPreviousHashes(loadPreviousManifest(outputDir));
  const freshness: SourceFreshness = { changed: [], unchanged: [] };

  const repos = stageRepos(options, { reposDir, docsDir, depth, dryRun, previous, freshness });
  const docs = stageDocs(options.docs ?? [], docsDir, dryRun, previous, freshness);
  const files = stageFiles(options.files ?? [], filesDir, dryRun, previous, freshness);
  const web = stageWeb(options.web ?? [], webDir, dryRun, previous, freshness);
  const context = stageContext(options.context ?? [], contextDir, dryRun, previous, freshness);

  const documentCount = docs.length + files.length + web.length;
  const { mode, cwd, instructions } = inferTutorSetupMode(repos, documentCount);
  const tutorSetupCwd = cwd.replace("{outputDir}", outputDir);

  const manifest: StageManifest = {
    version: STAGE_VERSION,
    createdAt: new Date().toISOString(),
    outputDir,
    repos,
    docs,
    files,
    web,
    context,
    tutorSetupMode: mode,
    tutorSetupCwd,
    instructions,
    freshness,
  };

  if (!dryRun) {
    writeFileSync(join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    writeFileSync(join(sourcesDir, "LEARN_PROJECT.md"), renderSummary(manifest), "utf8");
  }

  return manifest;
}

const USAGE =
  "Usage: stage-learn-sources <output-dir> [--repo owner/repo] [--local /path] [--doc title:path] [--file label:path] [--web url:path] [--context name:path] [--depth N] [--dry-run]";

function requireValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

/** Split `key:path` on the first (or last, for URLs) colon. */
function splitPair(value: string, flag: string, fromEnd: boolean): [string, string] {
  const colon = fromEnd ? value.lastIndexOf(":") : value.indexOf(":");
  if (colon <= 0) throw new Error(`${flag} requires <key>:<path>`);
  return [value.slice(0, colon), value.slice(colon + 1)];
}

function parseDepth(value: string): number {
  const depth = Number(value);
  if (!Number.isFinite(depth) || depth < 1) throw new Error("--depth must be a positive integer");
  return depth;
}

/** Parse CLI `--key value` pairs after the output directory positional. */
export function parseStageArgs(argv: readonly string[]): StageLearnSourcesOptions {
  const outputDir = argv[0];
  if (!outputDir) throw new Error(USAGE);

  const repos: string[] = [];
  const localRepos: string[] = [];
  const docs: StageDocInput[] = [];
  const files: StageFileInput[] = [];
  const web: StageWebInput[] = [];
  const context: StageContextInput[] = [];
  let depth = 1;
  let dryRun = false;

  const listFlags: Record<string, string[]> = { "--repo": repos, "--local": localRepos };
  const pairFlags: Record<string, (value: string) => void> = {
    "--doc": (v) => {
      const [title, sourcePath] = splitPair(v, "--doc", false);
      docs.push({ title, sourcePath });
    },
    "--file": (v) => {
      const [label, sourcePath] = splitPair(v, "--file", false);
      files.push({ label, sourcePath });
    },
    "--web": (v) => {
      const [url, sourcePath] = splitPair(v, "--web", true);
      web.push({ url, sourcePath });
    },
    "--context": (v) => {
      const [name, sourcePath] = splitPair(v, "--context", false);
      context.push({ name, sourcePath });
    },
  };

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    const list = listFlags[arg];
    if (list) {
      list.push(requireValue(argv, ++i, arg));
      continue;
    }
    const pair = pairFlags[arg];
    if (pair) {
      pair(requireValue(argv, ++i, arg));
      continue;
    }
    if (arg === "--depth") {
      depth = parseDepth(requireValue(argv, ++i, arg));
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { outputDir, repos, localRepos, docs, files, web, context, depth, dryRun };
}
