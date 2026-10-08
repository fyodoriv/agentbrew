import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/** Repo root from this module (`src/docs/` → repo root). CWD-independent. */
export function resolveRepoRoot(fromDir = import.meta.dirname): string {
  return resolve(fromDir, "..", "..");
}

// Count tokens: integers up to 999, or comma-grouped thousands. Four-plus digit runs
// without commas are out of scope (timestamps, IDs, line numbers).
const COUNT_NUMBER = String.raw`\d{1,3}(?:,\d{3})*|\d{1,3}`;

const INVENTORY_NOUN =
  "(?:agents?|skills?|commands?|servers?|tools?|modules?|entries|files|lines|tests|checks?|check-types?|carve-outs?|delegated|intersection|targets?|surfaces?|clients?)";

const VOLATILE_COUNT = `(?:${COUNT_NUMBER})(?:\\s*[–-]\\s*(?:${COUNT_NUMBER}))?\\+?`;
const INVENTORY_QUALIFIER = "(?:(?:[A-Za-z][\\w/-]*\\s+){0,3})";

/** Spelled counts for aggregate inventory (exclude one/two — transactional English, not inventory). */
const SPELLED_INVENTORY_NUMBERS = "three|four|five|six|seven|eight|nine|ten|eleven|twelve";

const VOLATILE_COUNT_CLAIM = new RegExp(
  String.raw`(?<![.\w-])${VOLATILE_COUNT}\s+${INVENTORY_QUALIFIER}${INVENTORY_NOUN}\b`,
  "giu",
);

const CARVE_OUT_NUMERIC =
  /\b(?:\d{1,3}(?:,\d{3})*|\d+)\s+carve-outs?\b|\b(?:\d{1,3}(?:,\d{3})*|\d+)\s+delegated\b|\b(?:\d{1,3}(?:,\d{3})*|\d+)\s+intersection\b|\bcarve-outs?\s+only:\s*(?:\d{1,3}(?:,\d{3})*|\d+)/giu;

const SPELLED_CARVE_OUT_AGENTS =
  /\b(?:two|three|Two|Three)\s+carve-out(?:\s+agents?)?\b|\b(?:two|Two)\s+carve-outs\b/giu;

const COMMANDS_CARVE_OUTS_TITLE = /\b(?:\d{1,3}(?:,\d{3})*|\d+)\s+commands?\s+carve-outs?\b/giu;

const KNOWN_CARVE_OUT_COUNT_TITLE = /\b(?:\d{1,3}(?:,\d{3})*|\d+)\s+known\s+carve-outs?\b/giu;

const EXAMPLE_STATUS_COUNTS = new RegExp(
  String.raw`\b(?:${COUNT_NUMBER})\s+skills\s+across\s+(?:${COUNT_NUMBER})\s+agents\b`,
  "giu",
);

const RENAME_AND_ONLY =
  /\b(?:\d{1,3}(?:,\d{3})*|\d+)\s+(?:renames?|pairs|agentbrew-only(?:\s+\w+)?)\b|\b(?:\d{1,3}(?:,\d{3})*|\d+)\s+pairs use\b|\b(?:\d{1,3}(?:,\d{3})*|\d+)\s+clients instead of (?:\d{1,3}(?:,\d{3})*|\d+)\b|\b(?:\d{1,3}(?:,\d{3})*|\d+)\s+small\b/giu;

/** Hyphen inventory prose (N-agent, N-carve-out). Reject story paths with trailing hyphen segments. */
const HYPHEN_INVENTORY =
  /\b[1-9]\d{0,1}-(?:agent|agents|command|commands|carve-out|carve-outs|check|checks|intersection|delegated|client|clients|skill|skills)\b(?!-)/giu;

const DIGIT_CHECK_TYPES = /\b(?:\d{1,3}(?:,\d{3})*|\d+)\s+check\s+types?\b/giu;

const SPELLED_INVENTORY = new RegExp(
  String.raw`\b(?:${SPELLED_INVENTORY_NUMBERS})\s+(?:(?:primary|agentbrew-process|strict|native|mcpm|commands?)\s+)*${INVENTORY_NOUN}\b`,
  "giu",
);

const THESE_ALL_SPELLED_AGENTS = new RegExp(
  String.raw`\b(?:these|all)\s+(?:${SPELLED_INVENTORY_NUMBERS}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:primary\s+)?agents?\b`,
  "giu",
);

const PLUS_THE_SPELLED_SKILLS = new RegExp(
  String.raw`\bplus\s+the\s+(?:${SPELLED_INVENTORY_NUMBERS}|six|seven|eight|nine|ten|eleven|twelve)\s+(?:agentbrew-process\s+)?skills?\b`,
  "giu",
);

const ALLOWLIST_MARKER = /volatile-count-allowlist:\s*\S/iu;

const GENERATED_SECTION_START = /^<!-- [\w-]+:start -->$/u;
const GENERATED_SECTION_END = /^<!-- [\w-]+:end -->$/u;

const USER_FACING_VOLATILE_COUNT_ROOT_FILES = [
  "VISION.md",
  "ARCHITECTURE.md",
  "AGENTS.md",
  "docs/shared-rules.md",
  "TASKS.md",
  "CHANGELOG.md",
  "RECURRING.md",
] as const;

/** Markdown paths guarded for volatile counts (root docs, user stories, every shipped SKILL.md and skill references/). */
export function getUserFacingVolatileCountFiles(repoRoot: string = resolveRepoRoot()): readonly string[] {
  return [
    ...USER_FACING_VOLATILE_COUNT_ROOT_FILES,
    ...listUserStoryMarkdown(repoRoot),
    ...listSkillMarkdown(repoRoot),
  ].sort();
}

function listUserStoryMarkdown(repoRoot: string): string[] {
  const userStoriesRoot = join(repoRoot, "docs", "user-stories");
  try {
    return listMarkdownFiles(userStoriesRoot, repoRoot);
  } catch {
    return ["docs/user-stories/01-get-started.md"];
  }
}

function listSkillMarkdown(repoRoot: string): string[] {
  const skillRoot = join(repoRoot, "skill-plugins");
  try {
    return listMarkdownFiles(skillRoot, repoRoot).filter((p) => p.endsWith("/SKILL.md") || p.includes("/references/"));
  } catch {
    return ["skill-plugins/dev/agentbrew-status/SKILL.md"];
  }
}

function listMarkdownFiles(dir: string, root: string): string[] {
  const entries = readdirSync(dir).sort();
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = join(dir, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      files.push(...listMarkdownFiles(absolute, root));
      continue;
    }
    if (entry.endsWith(".md")) {
      files.push(relative(root, absolute));
    }
  }
  return files;
}

export interface CommentSegment {
  lineNumber: number;
  text: string;
}

interface TextSpan {
  start: number;
  end: number;
}

/** UX/limit phrases: suppress only the inventory match that overlaps this span. */
const THRESHOLD_SPAN_PATTERNS = [
  /≤\d{1,3}(?:,\d{3})*\s+lines/giu,
  /under \d{1,3}(?:,\d{3})*\s+lines/giu,
  /under \d{1,3}(?:,\d{3})*\s+second/giu,
  /~\d{1,3}(?:,\d{3})*\s+entries/giu,
  /prints ≤\d{1,3}(?:,\d{3})*/giu,
  /past ~\d{1,3}(?:,\d{3})*\s+entries/giu,
  /~\d{1,3}(?:,\d{3})*\s+LOC/giu,
  /fewer than \d{1,3}(?:,\d{3})*\s+checks/giu,
  /more than ~\d{1,3}(?:,\d{3})*\s+skills/giu,
  /no-op sync prints ≤\d{1,3}(?:,\d{3})*\s+lines/giu,
  /≤\d{1,3}(?:,\d{3})*\s+lines\s+and\s+runs/giu,
  /Files ≤\d{1,3}(?:,\d{3})*\s+lines/giu,
  /Files >\d{1,3}(?:,\d{3})*\s+lines/giu,
  /first\/last \d{1,3}(?:,\d{3})*\s+lines/giu,
  />\d{1,3}(?:,\d{3})*-line docs/giu,
  /grow past ~\d{1,3}(?:,\d{3})*\s+lines/giu,
  /~\d{1,3}(?:,\d{3})*\s+lines for/giu,
  /Caps output at \d{1,3}(?:,\d{3})*\s+entries/giu,
  /first \d{1,3}(?:,\d{3})*\s+files/giu,
  /\+\s+maybe a blank line splitter = ≤\d{1,3}(?:,\d{3})*\s+lines/giu,
  /\d{1,3}(?:,\d{3})*-\d{1,3}(?:,\d{3})*\s+lines/giu,
  /\d{1,3}(?:,\d{3})*\s+blank\s+lines/giu,
  /≤\s*\d{1,3}(?:,\d{3})*\s+lines/giu,
  /wc -l[^\n]*≤\s*\d{1,3}(?:,\d{3})*\s+lines/giu,
  /→\s*~?\d{1,3}(?:,\d{3})*\s+lines/giu,
  /file\s*>\s*\d{1,3}(?:,\d{3})*\s+lines/giu,
  /≤\d{1,3}(?:,\d{3})*\s+LOC/giu,
  /≤\d{1,3}(?:,\d{3})*\+\s+LOC/giu,
  /first line ≤\d{1,3}(?:,\d{3})*\s+characters/giu,
  // Competitor dissolution bars (RECURRING.md Check 2) — decision thresholds, not repo inventory.
  /\d{1,3}\+\s+agent targets\b/giu,
] as const;

/** Spans that look like counts but are exit codes, durations, or ticket/PR refs — not inventory. */
const NON_INVENTORY_SPAN_PATTERNS = [
  /\bexits?\s+\d{1,3}\b/giu,
  /\bexit\s+(?:code\s+)?\d{1,3}\b/giu,
  /\b0\s+even\s+when\b/giu,
  /\d{1,3}\s+hours?\s+(?:across|per|every|between)\b/giu,
  /\d{1,3}\s+minutes?\s+(?:across|per|every|between)\b/giu,
  /\bdrift=0\b/giu,
  /\b0\s+across\s+ALL\s+agents\b/giu,
  /\b[A-Z][A-Z0-9]{1,15}-\d+\b/gu,
  /\bPR\s+#\d+\b/giu,
  /#\d{3,}\s+fixed\b/giu,
] as const;

function collectNonInventorySpans(text: string): TextSpan[] {
  const spans: TextSpan[] = [];
  for (const pattern of NON_INVENTORY_SPAN_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      spans.push({ start, end: start + match[0].length });
    }
  }
  return spans;
}

function isLeadingCountInIssueReference(text: string, matchStart: number): boolean {
  const before = text.slice(Math.max(0, matchStart - 16), matchStart);
  return /[A-Z][A-Z0-9]{1,15}-$/u.test(before) || /#\s*$/u.test(before) || /PR\s+#\s*$/iu.test(before);
}

function collectThresholdSpans(text: string): TextSpan[] {
  const spans: TextSpan[] = [];
  for (const pattern of THRESHOLD_SPAN_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      spans.push({ start, end: start + match[0].length });
    }
  }
  return spans;
}

function spansOverlap(a: TextSpan, b: TextSpan): boolean {
  return a.start < b.end && b.start < a.end;
}

function matchSpan(match: RegExpMatchArray): TextSpan {
  const start = match.index ?? 0;
  return { start, end: start + match[0].length };
}

function isMatchInThresholdExemption(text: string, match: RegExpMatchArray): boolean {
  const mSpan = matchSpan(match);
  return collectThresholdSpans(text).some((threshold) => spansOverlap(mSpan, threshold));
}

function isMatchInNonInventoryExemption(text: string, match: RegExpMatchArray): boolean {
  const mSpan = matchSpan(match);
  if (collectNonInventorySpans(text).some((span) => spansOverlap(mSpan, span))) {
    return true;
  }
  const start = match.index ?? 0;
  if (/^\d/u.test(match[0]) && isLeadingCountInIssueReference(text, start)) {
    return true;
  }
  return false;
}

/** Strip block and JSDoc line decoration for scanning. */
function normalizeBlockComment(raw: string): string {
  return raw
    .replace(/^\/\*+/u, "")
    .replace(/\*+\/$/u, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/u, "").trimEnd())
    .join("\n")
    .trim();
}

function scanCharOutsideStrings(line: string, onChar: (index: number, char: string, inString: boolean) => void): void {
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "'" && !inDouble && !inTemplate) inSingle = !inSingle;
    else if (char === '"' && !inSingle && !inTemplate) inDouble = !inDouble;
    else if (char === "`" && !inSingle && !inDouble) inTemplate = !inTemplate;
    onChar(i, char, inSingle || inDouble || inTemplate);
  }
}

/** Heuristic inline `//` comment (ignores `//` inside string literals). */
export function extractInlineComment(line: string): string | undefined {
  let found: string | undefined;
  scanCharOutsideStrings(line, (index, char, inString) => {
    if (inString || found !== undefined) return;
    if (char === "/" && line[index + 1] === "/") {
      found = line.slice(index + 2).trim();
    }
  });
  return found;
}

/** Same-line block comment segments (opener and closer on one line). */
export function extractInlineBlockComments(line: string): string[] {
  const segments: string[] = [];
  scanCharOutsideStrings(line, (index, char, inString) => {
    if (inString || char !== "/" || line[index + 1] !== "*") return;
    const end = line.indexOf("*/", index + 2);
    if (end === -1) return;
    segments.push(line.slice(index + 2, end).trim());
  });
  return segments;
}

type SourceScanMode = "code" | "single" | "double" | "template" | "lineComment" | "blockComment";

function appendLineCommentSegment(segments: CommentSegment[], lineNumber: number, text: string): void {
  const trimmed = text.trim();
  if (trimmed.length > 0) {
    segments.push({ lineNumber, text: trimmed });
  }
}

interface CommentLexerState {
  mode: SourceScanMode;
  lineNumber: number;
  lineCommentStartLine: number;
  lineCommentBuf: string;
  blockStartLine: number;
  blockBuf: string;
}

function stepCodeMode(index: number, char: string, next: string | undefined, state: CommentLexerState): number {
  if (char === "/" && next === "/") {
    state.mode = "lineComment";
    state.lineCommentStartLine = state.lineNumber;
    state.lineCommentBuf = "";
    return index + 1;
  }
  if (char === "/" && next === "*") {
    state.mode = "blockComment";
    state.blockStartLine = state.lineNumber;
    state.blockBuf = "";
    return index + 1;
  }
  if (char === "'") {
    state.mode = "single";
    return index;
  }
  if (char === '"') {
    state.mode = "double";
    return index;
  }
  if (char === "`") {
    state.mode = "template";
    return index;
  }
  if (char === "\n") {
    state.lineNumber += 1;
  }
  return index;
}

function stepLineCommentMode(
  index: number,
  char: string,
  state: CommentLexerState,
  segments: CommentSegment[],
): number {
  if (char === "\n") {
    appendLineCommentSegment(segments, state.lineCommentStartLine, state.lineCommentBuf);
    state.mode = "code";
    state.lineNumber += 1;
    return index;
  }
  state.lineCommentBuf += char;
  return index;
}

function stepBlockCommentMode(
  index: number,
  char: string,
  next: string | undefined,
  state: CommentLexerState,
  segments: CommentSegment[],
): number {
  if (char === "*" && next === "/") {
    const normalized = normalizeBlockComment(state.blockBuf);
    if (normalized.length > 0) {
      segments.push({ lineNumber: state.blockStartLine, text: normalized });
    }
    state.mode = "code";
    return index + 1;
  }
  if (char === "\n") {
    state.blockBuf += "\n";
    state.lineNumber += 1;
    return index;
  }
  state.blockBuf += char;
  return index;
}

function stepQuotedMode(
  index: number,
  char: string,
  next: string | undefined,
  quote: "'" | '"',
  state: CommentLexerState,
): number {
  if (char === "\\" && next !== undefined) {
    return index + 1;
  }
  if (char === quote) {
    state.mode = "code";
    return index;
  }
  if (char === "\n") {
    state.lineNumber += 1;
  }
  return index;
}

function stepTemplateMode(index: number, char: string, next: string | undefined, state: CommentLexerState): number {
  if (char === "\\" && next !== undefined) {
    return index + 1;
  }
  if (char === "`") {
    state.mode = "code";
    return index;
  }
  if (char === "\n") {
    state.lineNumber += 1;
  }
  return index;
}

function stepCommentLexer(
  _source: string,
  index: number,
  state: CommentLexerState,
  segments: CommentSegment[],
): number {
  const char = _source[index];
  const next = _source[index + 1];
  switch (state.mode) {
    case "code":
      return stepCodeMode(index, char, next, state);
    case "lineComment":
      return stepLineCommentMode(index, char, state, segments);
    case "blockComment":
      return stepBlockCommentMode(index, char, next, state, segments);
    case "single":
      return stepQuotedMode(index, char, next, "'", state);
    case "double":
      return stepQuotedMode(index, char, next, '"', state);
    default:
      return stepTemplateMode(index, char, next, state);
  }
}

/** Extract comments from TypeScript source (string/template-aware across lines). */
export function extractCommentSegments(source: string): CommentSegment[] {
  const segments: CommentSegment[] = [];
  const state: CommentLexerState = {
    mode: "code",
    lineNumber: 1,
    lineCommentStartLine: 1,
    lineCommentBuf: "",
    blockStartLine: 1,
    blockBuf: "",
  };

  for (let i = 0; i < source.length; i += 1) {
    i = stepCommentLexer(source, i, state, segments);
  }

  if (state.mode === "lineComment") {
    appendLineCommentSegment(segments, state.lineCommentStartLine, state.lineCommentBuf);
  } else if (state.mode === "blockComment") {
    const normalized = normalizeBlockComment(state.blockBuf);
    if (normalized.length > 0) {
      segments.push({ lineNumber: state.blockStartLine, text: normalized });
    }
  }

  return segments;
}

/** Archived measurement line immediately following an allowlist marker line. */
function isAllowlistedCompanionLine(allLines: readonly string[], lineNumber: number): boolean {
  const prev = allLines[lineNumber - 2];
  return prev !== undefined && ALLOWLIST_MARKER.test(prev);
}

const SCAN_PATTERNS = [
  VOLATILE_COUNT_CLAIM,
  CARVE_OUT_NUMERIC,
  EXAMPLE_STATUS_COUNTS,
  RENAME_AND_ONLY,
  HYPHEN_INVENTORY,
  DIGIT_CHECK_TYPES,
  SPELLED_INVENTORY,
  THESE_ALL_SPELLED_AGENTS,
  PLUS_THE_SPELLED_SKILLS,
  SPELLED_CARVE_OUT_AGENTS,
  COMMANDS_CARVE_OUTS_TITLE,
  KNOWN_CARVE_OUT_COUNT_TITLE,
] as const;

interface RawVolatileMatch {
  value: string;
  index: number;
}

function findVolatileMatchesInText(text: string): RawVolatileMatch[] {
  const matches: RawVolatileMatch[] = [];
  const seen = new Set<string>();
  for (const pattern of SCAN_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const value = match[0];
      const key = `${value}@${match.index ?? 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (isMatchInThresholdExemption(text, match)) {
        continue;
      }
      if (isMatchInNonInventoryExemption(text, match)) {
        continue;
      }
      matches.push({ value, index: match.index ?? 0 });
    }
  }
  return matches;
}

/** Exported for unit tests. */
export function scanTextForVolatileCounts(text: string): string[] {
  return findVolatileMatchesInText(text).map((m) => m.value);
}

function collectViolationsFromText(
  text: string,
  physicalLineNumber: number,
  allLines: readonly string[],
  relativePath: string,
  kind: "markdown" | "comment" | "test-title",
): string[] {
  const lineContent = allLines[physicalLineNumber - 1] ?? text;
  if (ALLOWLIST_MARKER.test(lineContent) && findVolatileMatchesInText(text).length === 0) {
    return [];
  }
  if (isAllowlistedCompanionLine(allLines, physicalLineNumber)) {
    return [];
  }

  const violations: string[] = [];
  for (const { value } of findVolatileMatchesInText(text)) {
    const message =
      kind === "markdown"
        ? `${relativePath}:${physicalLineNumber}: volatile count "${value}" — delete it, link agents.yaml / README agent matrix / carve-out matrix tests, or generate at runtime.`
        : kind === "test-title"
          ? `${relativePath}:${physicalLineNumber}: volatile count "${value}" in test title — use source-of-truth set/symbol names instead of inventory prose.`
          : `${relativePath}:${physicalLineNumber}: volatile count "${value}" in comment — use \`AGENTBREW_ONLY_*\` / \`MCP_INTERSECTION_AGENTS\` / matrix tests, or add \`volatile-count-allowlist: reason\` for archived measurements.`;
    violations.push(message);
  }
  return violations;
}

interface MarkdownScanState {
  inHtmlComment: boolean;
  inCodeFence: boolean;
  insideGeneratedSection: boolean;
}

function stepMarkdownFenceAndGenerated(line: string, state: MarkdownScanState): void {
  const trimmed = line.trim();
  if (GENERATED_SECTION_START.test(trimmed)) {
    state.insideGeneratedSection = true;
  }
  if (GENERATED_SECTION_END.test(trimmed)) {
    state.insideGeneratedSection = false;
  }
  if (trimmed.startsWith("```")) {
    state.inCodeFence = !state.inCodeFence;
  }
}

/** Text outside HTML comments on one line (may be empty). Updates `inHtmlComment`. */
function scannableMarkdownSegments(line: string, state: MarkdownScanState): string[] {
  if (state.inHtmlComment) {
    const end = line.indexOf("-->");
    if (end === -1) {
      return [];
    }
    state.inHtmlComment = false;
    return scannableMarkdownSegments(line.slice(end + 3), state);
  }

  const start = line.indexOf("<!--");
  if (start === -1) {
    return line.length > 0 ? [line] : [];
  }

  const segments: string[] = [];
  const before = line.slice(0, start);
  if (before.length > 0) {
    segments.push(before);
  }
  const end = line.indexOf("-->", start + 4);
  if (end === -1) {
    state.inHtmlComment = true;
    return segments;
  }
  segments.push(...scannableMarkdownSegments(line.slice(end + 3), state));
  return segments;
}

export function findVolatileCountClaimsInMarkdown(markdown: string, relativePath: string): string[] {
  const lines = markdown.split("\n");
  const violations: string[] = [];
  const state: MarkdownScanState = {
    inHtmlComment: false,
    inCodeFence: false,
    insideGeneratedSection: false,
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (state.inCodeFence || state.insideGeneratedSection) {
      stepMarkdownFenceAndGenerated(line, state);
      return;
    }

    const segments = scannableMarkdownSegments(line, state);
    stepMarkdownFenceAndGenerated(line, state);
    if (segments.length === 0) {
      return;
    }
    for (const segment of segments) {
      violations.push(...collectViolationsFromText(segment, lineNumber, lines, relativePath, "markdown"));
    }
  });

  return violations;
}

export function findVolatileCountClaimsInComments(source: string, relativePath: string): string[] {
  const lines = source.split("\n");
  const violations: string[] = [];

  for (const segment of extractCommentSegments(source)) {
    const segmentLines = segment.text.split("\n");
    for (let offset = 0; offset < segmentLines.length; offset += 1) {
      const physicalLine = segment.lineNumber + offset;
      const subline = segmentLines[offset] ?? "";
      violations.push(...collectViolationsFromText(subline, physicalLine, lines, relativePath, "comment"));
    }
  }

  return violations;
}

const TEST_TITLE_RE = /\b(?:it|describe)\(\s*(['"`])([\s\S]*?)\1/gm;

/** Transactional test titles — outside aggregate self-inventory policy. */
const TEST_TITLE_OUT_OF_SCOPE =
  /^(?:continues when|skips unreadable|continues syncing other agents when|emits one agent name per|emits one client name per|compact \+ drift|No path collision|all registered drift check|inverts every|fewer than \d+ checks|trims to last \d+ lines|aggregates drift from all registered)/u;

function shouldSkipTestTitle(title: string): boolean {
  if (TEST_TITLE_OUT_OF_SCOPE.test(title)) {
    return true;
  }
  if (/≤\d+\s+lines/u.test(title) && !scanTextForVolatileCounts(title.replace(/≤\d+\s+lines/giu, "")).length) {
    return true;
  }
  if (/under \d+ lines/u.test(title) && !findVolatileMatchesInText(title.replace(/under \d+ lines/giu, "")).length) {
    return true;
  }
  return false;
}

export function findVolatileCountClaimsInTestTitles(source: string, relativePath: string): string[] {
  if (!relativePath.endsWith(".test.ts")) {
    return [];
  }
  const lines = source.split("\n");
  const violations: string[] = [];
  for (const match of source.matchAll(TEST_TITLE_RE)) {
    const title = match[2] ?? "";
    if (shouldSkipTestTitle(title)) {
      continue;
    }
    const lineNumber = source.slice(0, match.index ?? 0).split("\n").length;
    violations.push(...collectViolationsFromText(title, lineNumber, lines, relativePath, "test-title"));
  }
  return violations;
}

function listTypeScriptFiles(dir: string, root: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = join(dir, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      files.push(...listTypeScriptFiles(absolute, root));
      continue;
    }
    if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      files.push(relative(root, absolute));
    }
  }
  return files;
}

/** Scan every TypeScript file under src/ for volatile inventory counts in comments and test titles. */
export function findVolatileCountClaimsInSrcComments(repoRoot: string): string[] {
  const srcRoot = join(repoRoot, "src");
  return listTypeScriptFiles(srcRoot, repoRoot).flatMap((relativePath) => {
    const source = readFileSync(join(repoRoot, relativePath), "utf-8");
    return [
      ...findVolatileCountClaimsInComments(source, relativePath),
      ...findVolatileCountClaimsInTestTitles(source, relativePath),
    ];
  });
}
