export const DEPLOYED_RULES_FILE_CHAR_BUDGET = 40_000;

export const SHARED_RULES_SECTION_TOKEN_BUDGET = 5000;

/** Per-section token ceilings (context-budget P0 trims). */
export const SHARED_RULES_SECTION_TOKEN_LIMITS: Readonly<Record<string, number>> = {
  communication: 400,
  "pull/fetch latest workflow": 1_200,
  "catalog rule markers": 5_000,
};

/** ~200 tokens — shared-rules growth above committed baseline without a trim task fails lint. */
export const SHARED_RULES_GROWTH_CHAR_THRESHOLD = 800;

export function sectionTokenBudgetForHeading(heading: string): number {
  const normalized = heading.toLowerCase();
  for (const [key, limit] of Object.entries(SHARED_RULES_SECTION_TOKEN_LIMITS)) {
    if (normalized.includes(key)) return limit;
  }
  return SHARED_RULES_SECTION_TOKEN_BUDGET;
}

export type SharedRulesBloatFinding =
  | { kind: "duplicate-heading"; heading: string; lines: number[] }
  | { kind: "repeated-subsection"; marker: string; section: string; lines: number[] }
  | { kind: "section-budget"; heading: string; line: number; tokens: number };

type LineRegistry = Map<string, { label: string; lines: number[] }>;
type SectionMarkerRegistry = Map<string, { section: string; markers: LineRegistry }>;

function countTokens(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function normalizeRulesLabel(value: string): string {
  return value
    .replace(/\s+#+\s*$/, "")
    .replace(/^[─━]+\s*/, "")
    .replace(/\s*[─━]+$/, "")
    .trim();
}

export function subsectionMarkerText(line: string): string | undefined {
  const trimmed = line.trim();
  const markerMatch = /^[─━]{2,}\s+(.+?)\s*[─━]*$/.exec(trimmed);
  if (markerMatch) return normalizeRulesLabel(markerMatch[1]);
  const h2MarkerMatch = /^##(?!#)\s+(.+?[─━]{2,})\s*$/.exec(trimmed);
  return h2MarkerMatch ? normalizeRulesLabel(h2MarkerMatch[1]) : undefined;
}

export function h2HeadingText(line: string): string | undefined {
  const trimmed = line.trim();
  if (subsectionMarkerText(trimmed)) return undefined;
  const match = /^##(?!#)\s+(.+?)\s*$/.exec(trimmed);
  return match ? normalizeRulesLabel(match[1]) : undefined;
}

function addLine(registry: LineRegistry, label: string, line: number): void {
  const key = label.toLowerCase();
  const existing = registry.get(key);
  if (existing) {
    existing.lines.push(line);
  } else {
    registry.set(key, { label, lines: [line] });
  }
}

function sectionBudgetFinding(heading: string, line: number, tokens: number): SharedRulesBloatFinding | undefined {
  const budget = sectionTokenBudgetForHeading(heading);
  if (heading === "(preamble)" || tokens <= budget) return undefined;
  return { kind: "section-budget", heading, line, tokens };
}

function recordSubsectionMarker(
  markersBySection: SectionMarkerRegistry,
  section: string,
  marker: string,
  line: number,
): void {
  const sectionKey = section.toLowerCase();
  const sectionMarkers = markersBySection.get(sectionKey) ?? {
    section,
    markers: new Map<string, { label: string; lines: number[] }>(),
  };
  addLine(sectionMarkers.markers, marker, line);
  markersBySection.set(sectionKey, sectionMarkers);
}

function duplicateHeadingFindings(headingLines: LineRegistry): SharedRulesBloatFinding[] {
  return Array.from(headingLines.values())
    .filter((heading) => heading.lines.length > 1)
    .map((heading) => ({ kind: "duplicate-heading", heading: heading.label, lines: heading.lines }));
}

function repeatedSubsectionFindings(markersBySection: SectionMarkerRegistry): SharedRulesBloatFinding[] {
  return Array.from(markersBySection.values()).flatMap((section) =>
    Array.from(section.markers.values())
      .filter((marker) => marker.lines.length > 1)
      .map((marker) => ({
        kind: "repeated-subsection",
        marker: marker.label,
        section: section.section,
        lines: marker.lines,
      })),
  );
}

export function findSharedRulesBloat(content: string): SharedRulesBloatFinding[] {
  const findings: SharedRulesBloatFinding[] = [];
  const headingLines: LineRegistry = new Map();
  const markersBySection: SectionMarkerRegistry = new Map();
  let currentSection = "(preamble)";
  let currentSectionLine = 1;
  let currentSectionTokens = 0;

  const finishSection = () => {
    const finding = sectionBudgetFinding(currentSection, currentSectionLine, currentSectionTokens);
    if (finding) findings.push(finding);
  };

  for (const [index, line] of content.split("\n").entries()) {
    const lineNumber = index + 1;
    const marker = subsectionMarkerText(line);
    if (marker) recordSubsectionMarker(markersBySection, currentSection, marker, lineNumber);

    const heading = h2HeadingText(line);
    if (heading) {
      finishSection();
      addLine(headingLines, heading, lineNumber);
      currentSection = heading;
      currentSectionLine = lineNumber;
      currentSectionTokens = 0;
    } else {
      currentSectionTokens += countTokens(line);
    }
  }

  finishSection();

  return [...findings, ...duplicateHeadingFindings(headingLines), ...repeatedSubsectionFindings(markersBySection)];
}

export function projectedDeployedRulesSize(instructionsContent: string, deployRulesContent: string): number {
  const instructionsWrapper = "<!-- agentbrew:instructions:start -->\n\n<!-- agentbrew:instructions:end -->";
  const rulesWrapper = "<!-- agentbrew:start -->\n\n<!-- agentbrew:end -->";
  return (
    instructionsContent.trim().length +
    deployRulesContent.trim().length +
    instructionsWrapper.length +
    rulesWrapper.length +
    4
  );
}

const RULE_MARKER_RE = /^\s*<!--\s*rule:\s*\S+\s*-->\s*$/;
const AGENTFILE_RULES_MARKER_RE = /^\s*<!--\s*\/?agentfile-rules:\s*\S+\s*-->\s*$/;

const MIN_DEDUPE_PARAGRAPH_CHARS = 100;

interface Segment {
  lines: string[];
  key: string | undefined;
}

function isBoundary(line: string): boolean {
  return (
    subsectionMarkerText(line) !== undefined ||
    h2HeadingText(line) !== undefined ||
    RULE_MARKER_RE.test(line) ||
    AGENTFILE_RULES_MARKER_RE.test(line)
  );
}

function consumeManagedBlock(lines: string[], start: number): number {
  if (AGENTFILE_RULES_MARKER_RE.test(lines[start])) {
    for (let i = start + 1; i < lines.length; i++) {
      if (/^\s*<!--\s*\/agentfile-rules:/.test(lines[i])) return i + 1;
    }
    return lines.length;
  }
  for (let i = start + 1; i < lines.length; i++) {
    if (isBoundary(lines[i])) return i;
  }
  return lines.length;
}

function consumeSubsectionBlock(lines: string[], start: number): number {
  for (let i = start + 1; i < lines.length; i++) {
    if (isBoundary(lines[i])) return i;
  }
  return lines.length;
}

function consumeParagraph(lines: string[], start: number): number {
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === "" || isBoundary(lines[i])) return i;
  }
  return lines.length;
}

function normalizeBlock(lines: string[]): string {
  return lines
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();
}

function segmentSharedRules(content: string): Segment[] {
  const lines = content.split("\n");
  const segments: Segment[] = [];
  let currentSection = "(preamble)";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      segments.push({ lines: [line], key: undefined });
      i++;
      continue;
    }
    if (RULE_MARKER_RE.test(line) || AGENTFILE_RULES_MARKER_RE.test(line)) {
      const end = consumeManagedBlock(lines, i);
      segments.push({ lines: lines.slice(i, end), key: undefined });
      i = end;
      continue;
    }
    const marker = subsectionMarkerText(line);
    if (marker !== undefined) {
      const end = consumeSubsectionBlock(lines, i);
      segments.push({
        lines: lines.slice(i, end),
        key: `sub:${JSON.stringify([currentSection, marker].map((s) => s.toLowerCase()))}`,
      });
      i = end;
      continue;
    }
    const heading = h2HeadingText(line);
    if (heading !== undefined) {
      currentSection = heading;
      segments.push({ lines: [line], key: undefined });
      i++;
      continue;
    }
    const end = consumeParagraph(lines, i);
    const block = lines.slice(i, end);
    const normalized = normalizeBlock(block);
    const key = normalized.length >= MIN_DEDUPE_PARAGRAPH_CHARS ? `para:${normalized}` : undefined;
    segments.push({ lines: block, key });
    i = end;
  }
  return segments;
}

export interface DedupeResult {
  content: string;
  removedCount: number;
  removed: string[];
}

function countSegmentKeys(segments: Segment[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const segment of segments) {
    if (segment.key) totals.set(segment.key, (totals.get(segment.key) ?? 0) + 1);
  }
  return totals;
}

function removedSegmentLabel(segment: Segment): string {
  const key = segment.key ?? "";
  if (key.startsWith("sub:")) {
    const parsed: unknown = JSON.parse(key.slice(4));
    if (Array.isArray(parsed) && typeof parsed[1] === "string") return parsed[1];
  }
  return segment.lines[0].trim();
}

function collectDedupedSegments(
  segments: Segment[],
  totals: Map<string, number>,
): { kept: Segment[]; removed: string[] } {
  const seen = new Map<string, number>();
  const kept: Segment[] = [];
  const removed: string[] = [];
  for (const segment of segments) {
    const total = segment.key ? (totals.get(segment.key) ?? 0) : 0;
    if (!segment.key || total < 2) {
      kept.push(segment);
      continue;
    }
    const occurrence = (seen.get(segment.key) ?? 0) + 1;
    seen.set(segment.key, occurrence);
    if (occurrence < total) {
      removed.push(removedSegmentLabel(segment));
      continue;
    }
    kept.push(segment);
  }
  return { kept, removed };
}

function rebuildSegments(segments: Segment[]): string {
  return segments
    .map((segment) => segment.lines.join("\n"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

import { indexOfMarkerAtLineStart } from "./sync/marker-utils.js";

/** Remove a single agentfile-rules managed block (used when deduping merge input). */
export function removeAgentfileRulesBlock(content: string, sourceId: string): string {
  const open = `<!-- agentfile-rules: ${sourceId} -->`;
  const close = `<!-- /agentfile-rules: ${sourceId} -->`;
  const openIdx = indexOfMarkerAtLineStart(content, open);
  const closeIdx = indexOfMarkerAtLineStart(content, close);
  if (openIdx === -1 || closeIdx === -1 || closeIdx <= openIdx) return content;
  return `${content.slice(0, openIdx)}${content.slice(closeIdx + close.length)}`;
}

function collectSegmentKeys(content: string): Set<string> {
  const keys = new Set<string>();
  for (const segment of segmentSharedRules(content)) {
    if (segment.key) keys.add(segment.key);
  }
  return keys;
}

/** Index subsection/paragraph keys inside agentfile-rules blocks for cross-overlay merge dedupe. */
function collectAgentfileInteriorKeys(content: string): Set<string> {
  const keys = new Set<string>();
  const lines = content.split("\n");
  let inAgentfileBlock = false;
  let currentSection = "(preamble)";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*<!--\s*agentfile-rules:/.test(line)) {
      inAgentfileBlock = true;
      currentSection = "(preamble)";
      i++;
      continue;
    }
    if (/^\s*<!--\s*\/agentfile-rules:/.test(line)) {
      inAgentfileBlock = false;
      i++;
      continue;
    }
    if (!inAgentfileBlock) {
      i++;
      continue;
    }
    const marker = subsectionMarkerText(line);
    if (marker !== undefined) {
      keys.add(`sub:${JSON.stringify([currentSection, marker].map((s) => s.toLowerCase()))}`);
      i = consumeSubsectionBlock(lines, i);
      continue;
    }
    const heading = h2HeadingText(line);
    if (heading !== undefined) {
      currentSection = heading;
      i++;
      continue;
    }
    const end = consumeParagraph(lines, i);
    const block = lines.slice(i, end);
    const normalized = normalizeBlock(block);
    if (normalized.length >= MIN_DEDUPE_PARAGRAPH_CHARS) keys.add(`para:${normalized}`);
    i = end;
  }
  return keys;
}

/** Drop subsection/paragraph blocks from incoming rules that already exist in shared-rules baseline. */
export function stripRulesDuplicatingExisting(
  existing: string,
  incoming: string,
  options?: { excludeSourceId?: string },
): string {
  const baseline = options?.excludeSourceId ? removeAgentfileRulesBlock(existing, options.excludeSourceId) : existing;
  const existingKeys = collectSegmentKeys(baseline);
  for (const key of collectAgentfileInteriorKeys(baseline)) existingKeys.add(key);
  if (existingKeys.size === 0) return incoming.trim();

  const kept = segmentSharedRules(incoming).filter((segment) => !segment.key || !existingKeys.has(segment.key));
  return rebuildSegments(kept).trim();
}

/** Strip catalog `<!-- rule: -->` blocks and `<!-- agentfile-rules: -->` managed sections for baseline comparison. */
export function stripManagedSharedRulesBlocks(content: string): string {
  const lines = content.split("\n");
  const kept: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (RULE_MARKER_RE.test(line) || AGENTFILE_RULES_MARKER_RE.test(line)) {
      i = consumeManagedBlock(lines, i);
      continue;
    }
    kept.push(line);
    i++;
  }
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

/**
 * Shortest unit deduped inside an `agentfile-rules` block.
 *
 * The 100-char floor that guards user-authored prose does not apply here.
 * Those blocks are generated from each `Agentfile.yaml` rule list, so a rule
 * repeated verbatim across blocks is the same directive emitted by two
 * sources, whatever its length. Short standing orders — "Run tests before
 * every commit." — are the ones that repeat most and cost the most in
 * aggregate. The floor only skips fragments too small to be a directive.
 */
const MIN_AGENTFILE_DEDUPE_CHARS = 12;

/**
 * True when the line continues the rule above rather than starting a new one.
 *
 * These blocks are emitted as a bare list with no blank line between entries,
 * so paragraph boundaries cannot separate one rule from the next. A rule too
 * long for one line is hard-wrapped, and every wrapped remainder resumes
 * mid-sentence in lowercase. Treating those remainders as rules would let a
 * shared fragment be deduped out of one rule while the rest of it stayed,
 * silently corrupting the instruction.
 */
function isRuleContinuation(line: string): boolean {
  return /^[a-z(]/.test(line.trim());
}

/** True when the line is a complete rule: not a continuation, and not continued. */
function isWholeRuleLine(lines: string[], index: number): boolean {
  if (isRuleContinuation(lines[index])) return false;
  const next = lines[index + 1];
  if (next === undefined || next.trim() === "" || isBoundary(next)) return true;
  return !isRuleContinuation(next);
}

function updateAgentfileRulesBlockState(line: string, inBlock: boolean): boolean {
  if (/^\s*<!--\s*agentfile-rules:/.test(line)) return true;
  if (/^\s*<!--\s*\/agentfile-rules:/.test(line)) return false;
  return inBlock;
}

function isAgentfileRulesBoundary(line: string, inBlock: boolean): boolean {
  return !inBlock || AGENTFILE_RULES_MARKER_RE.test(line) || line.trim() === "" || h2HeadingText(line) !== undefined;
}

function agentfileRuleBlockAt(lines: string[], index: number): { end: number; block: string[] } | undefined {
  const isSubsection = subsectionMarkerText(lines[index]) !== undefined;
  if (!isSubsection && !isWholeRuleLine(lines, index)) return undefined;
  const end = isSubsection ? consumeSubsectionBlock(lines, index) : index + 1;
  return { end, block: lines.slice(index, end) };
}

function keepOrRemoveAgentfileRuleBlock(block: string[], seen: Set<string>, kept: string[], removed: string[]): void {
  const normalized = normalizeBlock(block);
  if (normalized.length >= MIN_AGENTFILE_DEDUPE_CHARS && seen.has(normalized)) {
    removed.push(block[0].trim());
    return;
  }
  if (normalized.length >= MIN_AGENTFILE_DEDUPE_CHARS) seen.add(normalized);
  kept.push(...block);
}

/**
 * Drop paragraphs repeated across `agentfile-rules` blocks, keeping the first.
 *
 * Every repo with an `Agentfile.yaml` contributes its own block, and the
 * house rules overlap heavily — commit convention, test-before-commit, no
 * unverified completion claims. `segmentSharedRules` treats each block as one
 * opaque segment, so the general dedupe pass never looks inside and the same
 * sentence ships to every agent once per source. Restating a rule does not
 * strengthen it; it just spends the context budget that the rules themselves
 * are competing for.
 *
 * Only exact repeats are removed, and only within these generated blocks, so
 * no directive is lost and hand-written sections are untouched.
 */
function dedupeAgentfileRulesBlocks(content: string): { content: string; removed: string[] } {
  const lines = content.split("\n");
  const kept: string[] = [];
  const removed: string[] = [];
  const seen = new Set<string>();
  let inBlock = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    inBlock = updateAgentfileRulesBlockState(line, inBlock);

    if (isAgentfileRulesBoundary(line, inBlock)) {
      kept.push(line);
      i++;
      continue;
    }

    const ruleBlock = agentfileRuleBlockAt(lines, i);
    if (ruleBlock === undefined) {
      kept.push(line);
      i++;
      continue;
    }

    keepOrRemoveAgentfileRuleBlock(ruleBlock.block, seen, kept, removed);
    i = ruleBlock.end;
  }

  return { content: kept.join("\n"), removed };
}

export function dedupeSharedRulesContent(content: string): DedupeResult {
  const acrossBlocks = dedupeAgentfileRulesBlocks(content);
  const segments = segmentSharedRules(acrossBlocks.content);
  const totals = countSegmentKeys(segments);
  const { kept, removed: withinFile } = collectDedupedSegments(segments, totals);
  const removed = [...acrossBlocks.removed, ...withinFile];

  if (removed.length === 0) return { content, removedCount: 0, removed };

  const rebuilt = rebuildSegments(kept);
  return { content: `${rebuilt}\n`, removedCount: removed.length, removed };
}
