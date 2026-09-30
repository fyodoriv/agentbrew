import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import yaml from "js-yaml";
import { logSkipped } from "../core/logger.js";
import { getSkillSources } from "../sync/skills-sync.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type Severity = "error" | "warning" | "info";

interface ValidationIssue {
  severity: Severity;
  message: string;
  field?: string;
}

export interface SkillValidationResult {
  name: string;
  directory: string;
  sourceLabel: string;
  issues: ValidationIssue[];
  valid: boolean;
}

export interface ValidationSummary {
  total: number;
  valid: number;
  withErrors: number;
  withWarnings: number;
  results: SkillValidationResult[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
const MAX_NAME_LENGTH = 64;
const MIN_DESCRIPTION_LENGTH = 20;
const MIN_EVALS = 3;
const MIN_CHECKS_PER_EVAL = 3;

const KNOWN_FRONTMATTER_FIELDS = new Set([
  "name",
  "description",
  "disable-model-invocation",
  "user-invocable",
  "allowed-tools",
  "model",
  "context",
  "agent",
  "argument-hint",
  "hooks",
  "capabilities",
]);

// ── Frontmatter field helpers (private) ──────────────────────────────────────

const OPTIONAL_FIELD_CHECKS: Array<{
  field: string;
  check: (value: unknown) => boolean;
  expected: string;
}> = [
  { field: "disable-model-invocation", check: (v) => typeof v === "boolean", expected: "a boolean" },
  { field: "user-invocable", check: (v) => typeof v === "boolean", expected: "a boolean" },
  // allowed-tools: Claude Code accepts BOTH array form (`- Bash(git diff:*)`)
  // AND comma-separated string form (`Bash(git diff:*), Bash(git log:*)`).
  // See https://docs.claude.com/en/docs/claude-code/slash-commands and the
  // skill examples published by Anthropic (e.g. superpowers repo). Enforcing
  // array-only creates false-positive drift for valid skills written in the
  // string form — which is the more common form in practice.
  {
    field: "allowed-tools",
    check: (v) => Array.isArray(v) || typeof v === "string",
    expected: "an array or a comma-separated string",
  },
  { field: "model", check: (v) => typeof v === "string", expected: "a string" },
  { field: "context", check: (v) => Array.isArray(v), expected: "an array" },
  { field: "agent", check: (v) => Array.isArray(v), expected: "an array" },
];

function validateNameField(frontmatter: Record<string, unknown>, dirName: string): ValidationIssue[] {
  if (!frontmatter.name) {
    return [{ severity: "error", message: "Missing required field: name", field: "name" }];
  }
  if (typeof frontmatter.name !== "string") {
    return [{ severity: "error", message: "Field 'name' must be a string", field: "name" }];
  }
  if (frontmatter.name !== dirName) {
    return [
      {
        severity: "warning",
        message: `Name '${frontmatter.name}' does not match directory '${dirName}'`,
        field: "name",
      },
    ];
  }
  return [];
}

function validateDescriptionField(frontmatter: Record<string, unknown>): ValidationIssue[] {
  if (!frontmatter.description) {
    return [{ severity: "error", message: "Missing required field: description", field: "description" }];
  }
  if (typeof frontmatter.description !== "string") {
    return [{ severity: "error", message: "Field 'description' must be a string", field: "description" }];
  }
  const issues: ValidationIssue[] = [];
  const desc = frontmatter.description.trim();
  if (desc.length < MIN_DESCRIPTION_LENGTH) {
    issues.push({
      severity: "warning",
      message: `Description is short (${desc.length} chars, recommend ${MIN_DESCRIPTION_LENGTH}+)`,
      field: "description",
    });
  }
  if (!desc.toLowerCase().includes("don't use") && !desc.toLowerCase().includes("do not use")) {
    issues.push({
      severity: "info",
      message: "Description missing 'Don't use for...' guidance (helps agents pick the right skill)",
      field: "description",
    });
  }
  return issues;
}

function validateUnknownFields(frontmatter: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const key of Object.keys(frontmatter)) {
    if (!KNOWN_FRONTMATTER_FIELDS.has(key)) {
      issues.push({ severity: "warning", message: `Unknown frontmatter field: '${key}'`, field: key });
    }
  }
  return issues;
}

function validateOptionalFieldTypes(frontmatter: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const { field, check, expected } of OPTIONAL_FIELD_CHECKS) {
    if (frontmatter[field] !== undefined && !check(frontmatter[field])) {
      issues.push({ severity: "error", message: `Field '${field}' must be ${expected}`, field });
    }
  }
  return issues;
}

// ── Pure validation functions ────────────────────────────────────────────────

/** Validate a skill directory name. */
export function validateDirectoryName(dirName: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (dirName.length === 0) {
    issues.push({ severity: "error", message: "Directory name is empty", field: "directory" });
  } else if (dirName.length > MAX_NAME_LENGTH) {
    issues.push({
      severity: "error",
      message: `Directory name exceeds ${MAX_NAME_LENGTH} characters`,
      field: "directory",
    });
  } else if (!NAME_PATTERN.test(dirName)) {
    issues.push({
      severity: "error",
      message: "Directory name must be lowercase alphanumeric with hyphens",
      field: "directory",
    });
  }

  return issues;
}

/** Validate SKILL.md frontmatter. */
export function validateFrontmatter(content: string, dirName: string): ValidationIssue[] {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) {
    return [{ severity: "error", message: "Missing YAML frontmatter (must start with ---)", field: "frontmatter" }];
  }

  let frontmatter: Record<string, unknown>;
  try {
    frontmatter = yaml.load(fmMatch[1]) as Record<string, unknown>;
  } catch (error) {
    return [
      {
        severity: "error",
        message: `Invalid YAML frontmatter: ${error instanceof Error ? error.message : "parse error"}`,
        field: "frontmatter",
      },
    ];
  }

  if (!frontmatter || typeof frontmatter !== "object") {
    return [{ severity: "error", message: "Frontmatter is empty or not an object", field: "frontmatter" }];
  }

  return [
    ...validateNameField(frontmatter, dirName),
    ...validateDescriptionField(frontmatter),
    ...validateUnknownFields(frontmatter),
    ...validateOptionalFieldTypes(frontmatter),
  ];
}

/** Validate SKILL.md body content. */
export function validateBody(content: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  const body = bodyMatch ? bodyMatch[1].trim() : content.trim();

  if (body.length === 0) {
    issues.push({ severity: "error", message: "SKILL.md has no body content", field: "body" });
    return issues;
  }

  // Check for at least one heading
  if (!body.match(/^#{1,3}\s+.+$/m)) {
    issues.push({
      severity: "warning",
      message: "Body has no headings — consider adding ## sections for structure",
      field: "body",
    });
  }

  return issues;
}

/** Check for cross-referenced skills that don't exist. */
export function validateCrossReferences(
  content: string,
  allSkillNames: Set<string>,
  currentSkillName: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Match patterns like: (use review), (use `commit`), use the `plan` skill
  const refPatterns = [
    /\buse\s+(?:the\s+)?`?([a-z][a-z0-9-]+)`?(?:\s+skill)?\b/gi,
    /\*\*`?([a-z][a-z0-9-]+)`?\*\*\s*—/g,
  ];

  const referenced = new Set<string>();
  for (const pattern of refPatterns) {
    for (const match of content.matchAll(pattern)) {
      const ref = match[1].toLowerCase();
      if (ref !== currentSkillName && !referenced.has(ref)) {
        referenced.add(ref);
      }
    }
  }

  // Filter to only names that look like skill names (not generic words)
  const genericWords = new Set([
    "it",
    "this",
    "that",
    "the",
    "for",
    "with",
    "caution",
    "true",
    "false",
    "only",
    "when",
    "after",
    "before",
    "instead",
    "not",
    "and",
    "or",
  ]);

  for (const ref of referenced) {
    if (genericWords.has(ref)) continue;
    if (ref.length < 2) continue;
    if (!allSkillNames.has(ref)) {
      issues.push({
        severity: "info",
        message: `References skill '${ref}' which is not installed`,
        field: "cross-ref",
      });
    }
  }

  return issues;
}

/** Validate one entry inside an evals.json `evals` array. */
function validateEvalEntry(entry: unknown, index: number): ValidationIssue[] {
  const label = `eval[${index}]`;
  if (!entry || typeof entry !== "object") {
    return [{ severity: "error", message: `${label} is not an object`, field: "evals" }];
  }
  const issues: ValidationIssue[] = [];
  const { prompt, expectations, assertions } = entry as {
    prompt?: unknown;
    expectations?: unknown;
    assertions?: unknown;
  };
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    issues.push({ severity: "error", message: `${label} is missing a non-empty 'prompt'`, field: "evals" });
  }
  // Accept BOTH `expectations` (Anthropic skill-creator native) and `assertions`
  // (agentskills.io). Error only when neither yields enough non-empty checks.
  const checks = expectations ?? assertions;
  const checkCount = Array.isArray(checks)
    ? checks.filter((c) => typeof c === "string" && c.trim().length > 0).length
    : 0;
  if (checkCount < MIN_CHECKS_PER_EVAL) {
    issues.push({
      severity: "error",
      message: `${label} needs ≥${MIN_CHECKS_PER_EVAL} non-empty 'expectations' or 'assertions' (found ${checkCount})`,
      field: "evals",
    });
  }
  return issues;
}

/**
 * Validate a skill's `evals/evals.json` against the agentskills.io / Anthropic
 * skill-creator schema. Kept SEPARATE from {@link validateSkill} so the shared
 * lint + drift path is unaffected while skills are still acquiring evals —
 * making "missing evals" a structural error would break `lint`/`status` for
 * every skill that hasn't been authored yet. Consumed by `computeSkillCoverage`
 * and (later) the gh-pr-skill-requires-evals hook. Accepts both `expectations`
 * and `assertions` for the per-eval check list.
 */
export function validateEvals(skillDir: string): ValidationIssue[] {
  const evalsPath = join(skillDir, "evals", "evals.json");
  if (!existsSync(evalsPath)) {
    return [{ severity: "error", message: "Missing evals/evals.json", field: "evals" }];
  }
  let content: string;
  try {
    content = readFileSync(evalsPath, "utf-8");
  } catch (e) {
    logSkipped("skills/validate/validateEvals/readFileSync", e);
    return [{ severity: "error", message: "Cannot read evals/evals.json", field: "evals" }];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return [
      {
        severity: "error",
        message: `Invalid JSON in evals/evals.json: ${error instanceof Error ? error.message : "parse error"}`,
        field: "evals",
      },
    ];
  }
  const evals = (parsed as { evals?: unknown } | null)?.evals;
  if (!Array.isArray(evals)) {
    return [{ severity: "error", message: "evals/evals.json must contain an 'evals' array", field: "evals" }];
  }
  const issues: ValidationIssue[] = [];
  if (evals.length < MIN_EVALS) {
    issues.push({
      severity: "error",
      message: `evals/evals.json has ${evals.length} evals (minimum ${MIN_EVALS})`,
      field: "evals",
    });
  }
  for (const [index, entry] of evals.entries()) {
    issues.push(...validateEvalEntry(entry, index));
  }
  return issues;
}

/** Validate a single skill. */
export function validateSkill(
  directory: string,
  sourceLabel: string,
  allSkillNames: Set<string>,
): SkillValidationResult {
  const dirName = basename(directory);
  const issues: ValidationIssue[] = [];

  // Directory name validation
  issues.push(...validateDirectoryName(dirName));

  // SKILL.md existence
  const skillMdPath = join(directory, "SKILL.md");
  if (!existsSync(skillMdPath)) {
    issues.push({ severity: "error", message: "SKILL.md not found", field: "file" });
    return {
      name: dirName,
      directory,
      sourceLabel,
      issues,
      valid: false,
    };
  }

  // Read content
  let content: string;
  try {
    content = readFileSync(skillMdPath, "utf-8");
  } catch (e) {
    logSkipped("skills/validate/readFileSync", e);
    issues.push({ severity: "error", message: "Cannot read SKILL.md", field: "file" });
    return {
      name: dirName,
      directory,
      sourceLabel,
      issues,
      valid: false,
    };
  }

  // Frontmatter validation
  issues.push(...validateFrontmatter(content, dirName));

  // Body validation
  issues.push(...validateBody(content));

  // Cross-reference validation
  issues.push(...validateCrossReferences(content, allSkillNames, dirName));

  const hasErrors = issues.some((i) => i.severity === "error");

  return {
    name: dirName,
    directory,
    sourceLabel,
    issues,
    valid: !hasErrors,
  };
}

// ── Orchestration ────────────────────────────────────────────────────────────

/** Validate all skills from all sources. */
export function validateAllSkills(): ValidationSummary {
  const sources = getSkillSources();

  // Collect all skill names first for cross-reference checking
  const allSkillNames = new Set<string>();
  const skillEntries: Array<{ directory: string; sourceLabel: string }> = [];

  for (const source of sources) {
    for (const skillPath of source.scanner(source.path)) {
      const name = basename(skillPath);
      if (!allSkillNames.has(name)) {
        allSkillNames.add(name);
        skillEntries.push({ directory: skillPath, sourceLabel: source.label });
      }
    }
  }

  const results = skillEntries.map((entry) => validateSkill(entry.directory, entry.sourceLabel, allSkillNames));

  return {
    total: results.length,
    valid: results.filter((r) => r.valid).length,
    withErrors: results.filter((r) => r.issues.some((i) => i.severity === "error")).length,
    withWarnings: results.filter((r) => r.issues.some((i) => i.severity === "warning")).length,
    results,
  };
}
export { showValidationResults } from "./skill-validate-display.js";
