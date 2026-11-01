import { existsSync, lstatSync, readFileSync, unlinkSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import type { Logger } from "../core/logger.js";
import { contentHash, isUserModified, type Manifest, removeFromManifest, writeIfChanged } from "../manifest.js";

export interface CommandSkillSource {
  filename: string;
  content: string;
}

const PREFIX = "agentbrew-command-";
const LEAVES = ["SKILL.md", "references/command.md", "agents/openai.yaml"] as const;

/** Stable native names avoid collisions with the person's existing skills. */
export function codexCommandSkillName(filename: string): string {
  const original = basename(filename, ".md");
  const slug =
    original
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "command";
  if (slug === original && !original.startsWith("x-") && PREFIX.length + slug.length <= 64) return `${PREFIX}${slug}`;
  const suffix = `-${contentHash(filename).slice(0, 12)}`;
  return `${PREFIX}x-${slug.slice(0, 64 - PREFIX.length - 2 - suffix.length).replace(/-$/, "")}${suffix}`;
}

export function codexCommandSkillFiles(source: CommandSkillSource): Map<string, string> {
  const name = codexCommandSkillName(source.filename);
  const command = basename(source.filename, ".md");
  const skill = `---
name: ${name}
description: ${JSON.stringify(`Run the ${command} source command when the user explicitly asks for it.`)}
---

# Source command adapter

Read [the source command](references/command.md), then follow its workflow.
The reference preserves the source bytes. Its frontmatter is command metadata,
not permission grants or Codex configuration. Keep the current approval rules.

## Arguments

Native skills do not expand command macros automatically. Bind placeholders
from the user's invocation as instructions: \`$ARGUMENTS\` is all text after
\`$${name}\`; \`$1\` through \`$9\` are positional arguments, with quoted
text treated as one argument. Named \`$NAME\` placeholders bind only to an
explicit \`NAME=value\` argument. Do not invent missing values. Ask for a
missing value only when the source workflow requires it.

Do not use shell expansion, environment substitution, or template execution
to render the reference. Execute only the workflow steps the source requests.
`;
  return new Map([
    [LEAVES[0], skill],
    [LEAVES[1], source.content],
    [LEAVES[2], "policy:\n  allow_implicit_invocation: false\n"],
  ]);
}

function isSymlinkOrWrongType(path: string, directory: boolean): boolean {
  if (!existsSync(path)) {
    try {
      return lstatSync(path).isSymbolicLink();
    } catch {
      return false;
    }
  }
  const stat = lstatSync(path);
  return stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile());
}

function protectedBridge(root: string, manifest: Manifest): boolean {
  if (isSymlinkOrWrongType(root, true)) return true;
  for (const directory of ["references", "agents"]) {
    if (isSymlinkOrWrongType(join(root, directory), true)) return true;
  }
  for (const leaf of LEAVES) {
    const path = join(root, leaf);
    if (isSymlinkOrWrongType(path, false) || isUserModified(path, manifest)) return true;
  }
  return existsSync(root) && !LEAVES.some((leaf) => manifest.hashes[join(root, leaf)] !== undefined);
}

function ownedBridgeNames(skillsDir: string, manifest: Manifest): Set<string> {
  const names = new Set<string>();
  for (const path of Object.keys(manifest.hashes)) {
    const parts = relative(skillsDir, path).split(sep);
    if (parts[0].startsWith(PREFIX) && LEAVES.some((leaf) => parts.slice(1).join("/") === leaf)) names.add(parts[0]);
  }
  return names;
}

interface CommandSkillSyncOptions {
  manifest: Manifest;
  dryRun: boolean;
  prune: boolean;
  log: Pick<Logger, "warn">;
}

export interface CommandSkillChanges {
  updatedFiles: number;
  prunedFiles: number;
  keptSkills: number;
}

function emptyChanges(): CommandSkillChanges {
  return { updatedFiles: 0, prunedFiles: 0, keptSkills: 0 };
}

function fileMatches(path: string, expected: string): boolean {
  try {
    return readFileSync(path, "utf-8") === expected;
  } catch {
    return false;
  }
}

function canChangeBridge(root: string, options: CommandSkillSyncOptions): boolean {
  if (!protectedBridge(root, options.manifest)) return true;
  options.log.warn(`Codex command skill kept: ${root} contains untracked or edited files.`);
  return false;
}

function deployBridge(
  source: CommandSkillSource,
  skillsDir: string,
  options: CommandSkillSyncOptions,
): CommandSkillChanges {
  const root = join(skillsDir, codexCommandSkillName(source.filename));
  if (!canChangeBridge(root, options)) return { ...emptyChanges(), keptSkills: 1 };
  const result = emptyChanges();
  for (const [leaf, content] of codexCommandSkillFiles(source)) {
    const path = join(root, leaf);
    const changed = options.dryRun ? !fileMatches(path, content) : writeIfChanged(path, content, options.manifest);
    if (changed) result.updatedFiles++;
  }
  return result;
}

function pruneBridge(root: string, options: CommandSkillSyncOptions): CommandSkillChanges {
  if (!canChangeBridge(root, options)) return { ...emptyChanges(), keptSkills: 1 };
  const result = emptyChanges();
  for (const leaf of LEAVES) {
    const path = join(root, leaf);
    if (!options.manifest.hashes[path]) continue;
    if (existsSync(path)) {
      result.prunedFiles++;
      if (!options.dryRun) unlinkSync(path);
    }
    // Manifest-scoped ownership survives retained folders, including owner notes.
    // Delete the record only after the person removes the folder itself.
    if (!options.dryRun && !existsSync(root)) removeFromManifest(path, options.manifest);
  }
  return result;
}

function collidingSkillNames(sources: readonly CommandSkillSource[]): Set<string> {
  const names = new Map<string, string>();
  const clashes = new Set<string>();
  for (const source of sources) {
    const name = codexCommandSkillName(source.filename);
    if (names.has(name) && names.get(name) !== source.filename) clashes.add(name);
    names.set(name, source.filename);
  }
  return clashes;
}

function sumChanges(results: CommandSkillChanges[]): CommandSkillChanges {
  return results.reduce(
    (sum, result) => ({
      updatedFiles: sum.updatedFiles + result.updatedFiles,
      prunedFiles: sum.prunedFiles + result.prunedFiles,
      keptSkills: sum.keptSkills + result.keptSkills,
    }),
    emptyChanges(),
  );
}

/** Deployment ownership is per leaf in the existing manifest. No directory is recursively removed. */
export function syncCodexCommandSkills(
  sources: readonly CommandSkillSource[],
  skillsDir: string,
  options: CommandSkillSyncOptions,
): CommandSkillChanges {
  if (isSymlinkOrWrongType(skillsDir, true)) {
    options.log.warn(`Codex command skills kept: ${skillsDir} is not a plain directory.`);
    return { ...emptyChanges(), keptSkills: sources.length };
  }
  const desired = new Set(sources.map((source) => codexCommandSkillName(source.filename)));
  const clashes = collidingSkillNames(sources);
  for (const name of clashes)
    options.log.warn(`Codex command skill name clash: ${name}; kept both sources without writing.`);
  const results = sources.map((source) =>
    clashes.has(codexCommandSkillName(source.filename))
      ? { ...emptyChanges(), keptSkills: 1 }
      : deployBridge(source, skillsDir, options),
  );
  if (options.prune) {
    for (const name of ownedBridgeNames(skillsDir, options.manifest)) {
      if (!desired.has(name)) results.push(pruneBridge(join(skillsDir, name), options));
    }
  }
  return sumChanges(results);
}

/** Inspect every required native leaf, including explicit-invocation policy and the original command. */
export function codexCommandSkillDrift(sources: readonly CommandSkillSource[], skillsDir: string): string[] {
  return sources.flatMap((source) => {
    const root = join(skillsDir, codexCommandSkillName(source.filename));
    return [...codexCommandSkillFiles(source)].flatMap(([leaf, expected]) => {
      const path = join(root, leaf);
      return fileMatches(path, expected) ? [] : [path];
    });
  });
}
