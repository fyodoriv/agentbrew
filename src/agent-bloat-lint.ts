/**
 * Static bloat lint for agent-owned artifacts (skills, commands, Cursor rules).
 *
 * Prior art (see docs/agent-bloat-lint.md):
 * - agentskills.io spec (description ≤1024, progressive disclosure)
 * - audit-skill SK-020..SK-025 token/line budgets
 * - skill-tools / sklint frontmatter validators
 * - rulix token-budget validate
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { logSkipped } from "./core/logger.js";
import { isAlwaysApplied, isBroadGlob, parseMdcFrontmatter } from "./measure/mdc-frontmatter.js";
import { COMMANDS_DIR } from "./paths.js";
import { estimateTokens } from "./sync/instructions-content.js";
import { expandHome } from "./utils.js";

export type AgentBloatSurface = "skill" | "command" | "cursor-rule";

export type AgentBloatSeverity = "error" | "warning";

/** Stable rule ids for CI/docs tables. */
export const BLOAT_RULE = {
  SKILL_DESCRIPTION_MAX: "skill-description-max",
  SKILL_BODY_SOFT: "skill-body-soft",
  SKILL_BODY_HARD: "skill-body-hard",
  SKILL_LINES: "skill-lines",
  SKILL_NO_PROGRESSIVE_DISCLOSURE: "skill-no-progressive-disclosure",
  SKILL_BASELINE_GROWTH: "skill-baseline-growth",
  COMMAND_SOFT: "command-soft",
  COMMAND_HARD: "command-hard",
  MDC_FILE_SOFT: "mdc-file-soft",
  MDC_FILE_HARD: "mdc-file-hard",
  MDC_ALWAYS_APPLY_BROAD: "mdc-always-apply-broad",
  MDC_BROAD_GLOB: "mdc-broad-glob",
} as const;

export interface AgentBloatFinding {
  ruleId: (typeof BLOAT_RULE)[keyof typeof BLOAT_RULE];
  surface: AgentBloatSurface;
  severity: AgentBloatSeverity;
  path: string;
  message: string;
  line?: number;
  measured?: number;
  threshold?: number;
}

/** audit-skill SK-021 early warning (~3500 tokens). */
export const SKILL_BODY_TOKEN_SOFT = 3500;
/** audit-skill SK-020 hard guidance (~5000 tokens) — warning in lint; trim via references/. */
export const SKILL_BODY_TOKEN_HARD = 5000;
/** audit-skill SK-022. */
export const SKILL_MAX_LINES = 500;
/** agentskills.io spec max description length. */
export const SKILL_DESCRIPTION_MAX_CHARS = 1024;
/** ~200 tokens — matches SHARED_RULES_GROWTH_CHAR_THRESHOLD in rules-hygiene.ts. */
export const SKILL_GROWTH_CHAR_THRESHOLD = 800;

export const COMMAND_CHAR_SOFT = 4000;
export const COMMAND_CHAR_HARD = 8000;

export const MDC_FILE_CHAR_SOFT = 8000;
export const MDC_FILE_CHAR_HARD = 12_000;

export interface SkillBaselineEntry {
  tokens: number;
  lines: number;
}

export type SkillBaselines = Record<string, SkillBaselineEntry>;

const DEFAULT_REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function splitSkillContent(content: string): { frontmatter: Record<string, unknown>; body: string } | undefined {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return undefined;
  try {
    const frontmatter = yaml.load(match[1]) as Record<string, unknown>;
    if (!frontmatter || typeof frontmatter !== "object") return undefined;
    return { frontmatter, body: match[2] };
  } catch {
    return undefined;
  }
}

function bodyTokenCount(body: string): number {
  return estimateTokens(body.trim());
}

function hasReferencesDir(skillDir: string): boolean {
  return existsSync(join(skillDir, "references")) || existsSync(join(skillDir, "reference"));
}

export function hasOpenTrimTask(
  tasksContent: string,
  keywords: RegExp = /(trim-|context-budget|token-budget|skill-bloat)/i,
): boolean {
  const lines = tasksContent.split("\n");
  let inOpen = false;
  for (const line of lines) {
    if (/^- \[ \]/.test(line)) inOpen = true;
    if (/^- \[x\]/i.test(line)) inOpen = false;
    if (inOpen && keywords.test(line)) return true;
  }
  return false;
}

export function loadSkillBaselines(repoRoot: string = DEFAULT_REPO_ROOT): SkillBaselines {
  const path = join(repoRoot, "docs", "skill-baselines.json");
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as SkillBaselines;
  } catch {
    return {};
  }
}

function skillDescriptionFindings(description: string, path: string): AgentBloatFinding[] {
  if (description.length <= SKILL_DESCRIPTION_MAX_CHARS) return [];
  return [
    {
      ruleId: BLOAT_RULE.SKILL_DESCRIPTION_MAX,
      surface: "skill",
      severity: "error",
      path,
      message: `description is ${description.length} chars > ${SKILL_DESCRIPTION_MAX_CHARS} (agentskills.io)`,
      measured: description.length,
      threshold: SKILL_DESCRIPTION_MAX_CHARS,
    },
  ];
}

function skillBodyFindings(
  tokens: number,
  lines: number,
  path: string,
  skillDir: string | undefined,
): AgentBloatFinding[] {
  const findings: AgentBloatFinding[] = [];
  if (tokens > SKILL_BODY_TOKEN_SOFT) {
    findings.push({
      ruleId: BLOAT_RULE.SKILL_BODY_SOFT,
      surface: "skill",
      severity: "warning",
      path,
      message: `SKILL.md body ~${tokens.toLocaleString()} tokens > soft target ${SKILL_BODY_TOKEN_SOFT.toLocaleString()}`,
      measured: tokens,
      threshold: SKILL_BODY_TOKEN_SOFT,
    });
  }
  if (tokens > SKILL_BODY_TOKEN_HARD) {
    findings.push({
      ruleId: BLOAT_RULE.SKILL_BODY_HARD,
      surface: "skill",
      severity: "warning",
      path,
      message: `SKILL.md body ~${tokens.toLocaleString()} tokens > ${SKILL_BODY_TOKEN_HARD.toLocaleString()} — split into references/`,
      measured: tokens,
      threshold: SKILL_BODY_TOKEN_HARD,
    });
  }
  if (lines > SKILL_MAX_LINES) {
    findings.push({
      ruleId: BLOAT_RULE.SKILL_LINES,
      surface: "skill",
      severity: "warning",
      path,
      message: `SKILL.md is ${lines} lines > ${SKILL_MAX_LINES}`,
      measured: lines,
      threshold: SKILL_MAX_LINES,
    });
  }
  if (tokens > SKILL_BODY_TOKEN_HARD && skillDir && !hasReferencesDir(skillDir)) {
    findings.push({
      ruleId: BLOAT_RULE.SKILL_NO_PROGRESSIVE_DISCLOSURE,
      surface: "skill",
      severity: "warning",
      path,
      message: `SKILL.md ~${tokens.toLocaleString()} tokens without references/ — move detail out of always-loaded body`,
      measured: tokens,
      threshold: SKILL_BODY_TOKEN_HARD,
    });
  }
  return findings;
}

function skillBaselineFinding(
  tokens: number,
  path: string,
  baseline: SkillBaselineEntry,
  hasOpenTrimTask: boolean | undefined,
): AgentBloatFinding | undefined {
  const tokenThreshold = Math.ceil(SKILL_GROWTH_CHAR_THRESHOLD / 4);
  const tokenDelta = tokens - baseline.tokens;
  if (tokenDelta <= tokenThreshold) return undefined;
  const severity: AgentBloatSeverity = hasOpenTrimTask ? "warning" : "error";
  return {
    ruleId: BLOAT_RULE.SKILL_BASELINE_GROWTH,
    surface: "skill",
    severity,
    path,
    message:
      severity === "error"
        ? `SKILL.md grew ~${tokenDelta.toLocaleString()} tokens vs docs/skill-baselines.json without an open trim task in TASKS.md`
        : `SKILL.md grew ~${tokenDelta.toLocaleString()} tokens vs baseline — open trim task linked`,
    measured: tokens,
    threshold: baseline.tokens,
  };
}

/** Lint one SKILL.md for bloat (pure — optional skillDir for references/ check). */
export function lintSkillBloat(
  content: string,
  options: {
    path: string;
    dirName: string;
    skillDir?: string;
    baseline?: SkillBaselineEntry;
    hasOpenTrimTask?: boolean;
  },
): AgentBloatFinding[] {
  const split = splitSkillContent(content);
  if (!split) return [];

  const description = typeof split.frontmatter.description === "string" ? split.frontmatter.description : "";
  const tokens = bodyTokenCount(split.body);
  const lines = content.split("\n").length;

  const findings = [
    ...skillDescriptionFindings(description, options.path),
    ...skillBodyFindings(tokens, lines, options.path, options.skillDir),
  ];
  if (options.baseline) {
    const baselineFinding = skillBaselineFinding(tokens, options.path, options.baseline, options.hasOpenTrimTask);
    if (baselineFinding) findings.push(baselineFinding);
  }
  return findings;
}

export function lintCommandBloat(content: string, path: string): AgentBloatFinding[] {
  const chars = Buffer.byteLength(content, "utf-8");
  const findings: AgentBloatFinding[] = [];
  if (chars > COMMAND_CHAR_SOFT) {
    findings.push({
      ruleId: BLOAT_RULE.COMMAND_SOFT,
      surface: "command",
      severity: "warning",
      path,
      message: `command is ${chars.toLocaleString()} chars > soft target ${COMMAND_CHAR_SOFT.toLocaleString()}`,
      measured: chars,
      threshold: COMMAND_CHAR_SOFT,
    });
  }
  if (chars > COMMAND_CHAR_HARD) {
    findings.push({
      ruleId: BLOAT_RULE.COMMAND_HARD,
      surface: "command",
      severity: "error",
      path,
      message: `command is ${chars.toLocaleString()} chars > ${COMMAND_CHAR_HARD.toLocaleString()} — split or link out detail`,
      measured: chars,
      threshold: COMMAND_CHAR_HARD,
    });
  }
  return findings;
}

export function lintMdcBloat(content: string, path: string): AgentBloatFinding[] {
  const findings: AgentBloatFinding[] = [];
  const bytes = Buffer.byteLength(content, "utf-8");
  const meta = parseMdcFrontmatter(content);
  const alwaysApplied = isAlwaysApplied(meta);

  if (bytes > MDC_FILE_CHAR_SOFT) {
    findings.push({
      ruleId: BLOAT_RULE.MDC_FILE_SOFT,
      surface: "cursor-rule",
      severity: "warning",
      path,
      message: `${basename(path)} is ${bytes.toLocaleString()} bytes > soft target ${MDC_FILE_CHAR_SOFT.toLocaleString()}`,
      measured: bytes,
      threshold: MDC_FILE_CHAR_SOFT,
    });
  }

  if (alwaysApplied && bytes > MDC_FILE_CHAR_HARD) {
    findings.push({
      ruleId: BLOAT_RULE.MDC_FILE_HARD,
      surface: "cursor-rule",
      severity: "error",
      path,
      message: `always-applied rule ${basename(path)} is ${bytes.toLocaleString()} bytes > ${MDC_FILE_CHAR_HARD.toLocaleString()}`,
      measured: bytes,
      threshold: MDC_FILE_CHAR_HARD,
    });
  }

  for (const glob of meta.globs ?? []) {
    if (isBroadGlob(glob)) {
      findings.push({
        ruleId: BLOAT_RULE.MDC_BROAD_GLOB,
        surface: "cursor-rule",
        severity: "warning",
        path,
        message: `broad glob "${glob}" — scope creep; prefer a narrow path prefix`,
      });
    }
  }

  if (alwaysApplied && (meta.globs ?? []).some(isBroadGlob)) {
    findings.push({
      ruleId: BLOAT_RULE.MDC_ALWAYS_APPLY_BROAD,
      surface: "cursor-rule",
      severity: "error",
      path,
      message: "always-applied rule uses broad glob(s) — loads on nearly every file",
    });
  }

  return findings;
}

function collectBuiltinSkillFindings(
  repoRoot: string,
  baselines: SkillBaselines,
  trimTaskOpen: boolean,
): AgentBloatFinding[] {
  const skillRoot = join(repoRoot, "skill-plugins", "dev");
  if (!existsSync(skillRoot)) return [];

  const findings: AgentBloatFinding[] = [];
  for (const entry of readdirSync(skillRoot)) {
    const skillDir = join(skillRoot, entry);
    const skillPath = join(skillDir, "SKILL.md");
    if (!existsSync(skillPath)) continue;
    const content = readFileSync(skillPath, "utf-8");
    findings.push(
      ...lintSkillBloat(content, {
        path: `skill-plugins/dev/${entry}/SKILL.md`,
        dirName: entry,
        skillDir,
        baseline: baselines[entry],
        hasOpenTrimTask: trimTaskOpen,
      }),
    );
  }
  return findings;
}

function collectCommandFindings(commandsDir: string): AgentBloatFinding[] {
  if (!existsSync(commandsDir)) return [];
  const findings: AgentBloatFinding[] = [];
  let files: string[];
  try {
    files = readdirSync(commandsDir).filter((f) => f.endsWith(".md"));
  } catch (e) {
    logSkipped("agent-bloat-lint/commands-dir", e);
    return findings;
  }
  for (const file of files) {
    const path = join(commandsDir, file);
    try {
      findings.push(...lintCommandBloat(readFileSync(path, "utf-8"), path));
    } catch (e) {
      logSkipped("agent-bloat-lint/command", e);
    }
  }
  return findings;
}

function collectMdcTemplateFindings(repoRoot: string): AgentBloatFinding[] {
  const templatesDir = join(repoRoot, "templates", "rules");
  if (!existsSync(templatesDir)) return [];
  const findings: AgentBloatFinding[] = [];
  for (const file of readdirSync(templatesDir).filter((f) => f.endsWith(".mdc"))) {
    const path = join(templatesDir, file);
    findings.push(...lintMdcBloat(readFileSync(path, "utf-8"), path));
  }
  return findings;
}

export interface CollectAgentBloatOptions {
  repoRoot?: string;
  commandsDir?: string;
  tasksMdPath?: string;
}

/** Collect all agent-bloat findings for repo-owned and deployed artifacts. */
export function collectAgentBloatFindings(options: CollectAgentBloatOptions = {}): AgentBloatFinding[] {
  const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT;
  const commandsDir = options.commandsDir ?? expandHome(COMMANDS_DIR);
  const tasksPath = options.tasksMdPath ?? join(repoRoot, "TASKS.md");

  let trimTaskOpen = false;
  if (existsSync(tasksPath)) {
    try {
      trimTaskOpen = hasOpenTrimTask(readFileSync(tasksPath, "utf-8"));
    } catch {
      trimTaskOpen = false;
    }
  }

  const baselines = loadSkillBaselines(repoRoot);
  return [
    ...collectBuiltinSkillFindings(repoRoot, baselines, trimTaskOpen),
    ...collectCommandFindings(commandsDir),
    ...collectMdcTemplateFindings(repoRoot),
  ];
}

export function summarizeAgentBloat(findings: AgentBloatFinding[]): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const finding of findings) {
    if (finding.severity === "error") errors++;
    else warnings++;
  }
  return { errors, warnings };
}
