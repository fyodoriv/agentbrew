import { basename } from "node:path";
import {
  indexOfMarkerAtLineStart,
  END_MARKER as MANAGED_END_MARKER,
  START_MARKER as MANAGED_START_MARKER,
} from "./marker-utils.js";
import { extractManagedSection, wrapManaged } from "./rules-sync.js";

const INSTRUCTIONS_START = "<!-- agentbrew:instructions:start -->";
const INSTRUCTIONS_END = "<!-- agentbrew:instructions:end -->";

/**
 * Default token warning threshold (~8,000 tokens estimated as bytes/4).
 * Deployed instructions above this size waste always-on context budget.
 */
export const DEFAULT_TOKEN_WARNING_THRESHOLD = 32_000; // ~8,000 tokens at 4 chars/token

/** True when the agent's rulesFile is the cross-tool AGENTS.md standard (symlink target). */
export function usesAgentsMdStandardPath(rulesFile: string): boolean {
  return basename(rulesFile) === "AGENTS.md";
}

/** Rough token estimate: 1 token ≈ 4 characters. */
export function estimateTokens(charCount: number | string): number {
  const len = typeof charCount === "string" ? charCount.length : charCount;
  return Math.ceil(len / 4);
}

/**
 * Measure each H2 section's size in the given markdown content.
 * Returns sections sorted largest-first.
 */
export function measureSections(content: string): Array<{ heading: string; chars: number }> {
  const lines = content.split("\n");
  const sections: Array<{ heading: string; startIdx: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^##\s+(.+)/);
    if (match) sections.push({ heading: match[1].trim(), startIdx: i });
  }

  return sections
    .map((section, idx) => {
      const endIdx = idx + 1 < sections.length ? sections[idx + 1].startIdx : lines.length;
      const sectionContent = lines.slice(section.startIdx, endIdx).join("\n");
      return { heading: section.heading, chars: sectionContent.length };
    })
    .sort((a, b) => b.chars - a.chars);
}

/** Find the end of a section (next H2 or end of file). */
function findSectionEnd(lines: string[], sectionStart: number): number {
  for (let i = sectionStart + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) return i;
  }
  return lines.length;
}

/**
 * Compress a manual skills listing into a compact category+count summary.
 *
 * Detects `## Skills` (case-insensitive) sections that enumerate skills by
 * category (bold labels like `**Workflow:**`) and replaces the body with a
 * one-line-per-category summary.  The source file is never modified — this
 * runs on the in-memory content during deploy.
 *
 * Returns the content unchanged if no skills listing is detected.
 */
export function compressSkillsListing(content: string): string {
  const lines = content.split("\n");
  const sectionStart = findSkillsSectionStart(lines);
  if (sectionStart === -1) return content;

  const sectionEnd = findSectionEnd(lines, sectionStart);
  const sectionLines = lines.slice(sectionStart + 1, sectionEnd);
  const categories = parseSkillCategories(sectionLines);
  if (categories.length === 0) return content;

  const totalSkills = categories.reduce((sum, cat) => sum + cat.count, 0);
  const summary = [
    lines[sectionStart], // keep original heading
    "",
    `${totalSkills} skills installed. Run \`agentbrew status\` or browse \`~/.*/skills/\` to see full details.`,
    "",
    ...categories.map((cat) => `- **${cat.name}:** ${cat.count} skill${cat.count > 1 ? "s" : ""}`),
    "",
  ];

  return [...lines.slice(0, sectionStart), ...summary, ...lines.slice(sectionEnd)].join("\n");
}

/** Find the line index of the `## Skills` heading. */
function findSkillsSectionStart(lines: string[]): number {
  return lines.findIndex((line) => /^##\s+skills\b/i.test(line));
}

/** Minimum skill count for a section to be considered a real listing (not prose). */
const MIN_SKILLS_FOR_COMPRESSION = 5;

/** Try to parse a bold-label line (e.g., `**Category:** \`s1\`, \`s2\``). */
function parseBoldCategoryLine(line: string): { name: string; inlineCount: number } | undefined {
  const boldMatch = line.match(/^\*\*([^*]+?):?\*\*\s*(?:\([^)]*\)\s*)?:?\s*(.*)/);
  if (!boldMatch) return undefined;

  const name = boldMatch[1].trim();
  const rest = boldMatch[2];
  const skills = rest.match(/`[^`]+`/g);
  return { name, inlineCount: skills?.length ?? 0 };
}

/**
 * Parse `**Category:** skill1, skill2, ...` lines and `- \`skill\`` bullet lists
 * from a skills section body.
 */
function parseSkillCategories(sectionLines: string[]): Array<{ name: string; count: number }> {
  const categories: Array<{ name: string; count: number }> = [];
  let currentBulletCategory: { name: string; count: number } | undefined;

  for (const line of sectionLines) {
    const boldParsed = parseBoldCategoryLine(line);
    if (boldParsed) {
      currentBulletCategory = flushAndStartCategory(currentBulletCategory, boldParsed, categories);
      continue;
    }

    // Bullet list skill: `- \`skill-name\` — description`
    if (/^[-*]\s+`[^`]+`/.test(line) && currentBulletCategory) {
      currentBulletCategory.count++;
    }
  }

  // Flush final bullet category
  if (currentBulletCategory && currentBulletCategory.count > 0) {
    categories.push(currentBulletCategory);
  }

  // Only compress if there are enough skills to be worth it
  const totalSkills = categories.reduce((sum, c) => sum + c.count, 0);
  return totalSkills < MIN_SKILLS_FOR_COMPRESSION ? [] : categories;
}

/** Flush a pending bullet category and start tracking a new bold-label category. */
function flushAndStartCategory(
  pending: { name: string; count: number } | undefined,
  parsed: { name: string; inlineCount: number },
  categories: Array<{ name: string; count: number }>,
): { name: string; count: number } | undefined {
  if (pending && pending.count > 0) categories.push(pending);
  if (parsed.inlineCount > 0) {
    categories.push({ name: parsed.name, count: parsed.inlineCount });
    return undefined;
  }
  return { name: parsed.name, count: 0 };
}

/** Extract the "Auto-Synced Cursor Rules" section (everything after that heading). */
export function extractCursorRules(content: string): string {
  const marker = "## Auto-Synced Cursor Rules";
  const idx = content.indexOf(marker);
  if (idx === -1) return "";

  const afterMarker = content.slice(idx + marker.length);
  // Skip the auto-generated note line (starts with ">")
  const lines = afterMarker.split("\n");
  let started = false;
  const result: string[] = [];
  for (const line of lines) {
    if (!started) {
      if (line.startsWith(">") || line.trim() === "") continue;
      started = true;
    }
    if (started) result.push(line);
  }
  return `${result.join("\n").trim()}\n`;
}

/**
 * Strip the "Auto-Synced Cursor Rules" section from managed rules content.
 * Removes the `## Auto-Synced Cursor Rules` heading and all content until the
 * next H2 heading (or end of file). Content before and after the section is preserved.
 *
 * These rules are already deployed as per-file rules to agents with rulesDir
 * (Cursor), so including them in the shared rulesFile is redundant.
 */
export function stripCursorRulesSection(content: string): string {
  const lines = content.split("\n");
  const sectionStart = lines.findIndex((line) => /^##\s+Auto-Synced Cursor Rules\b/i.test(line));
  if (sectionStart === -1) return content;

  const sectionEnd = findSectionEnd(lines, sectionStart);
  const before = lines.slice(0, sectionStart);
  const after = lines.slice(sectionEnd);

  // Clean up trailing blank lines from before + leading blank lines from after
  while (before.length > 0 && before[before.length - 1].trim() === "") before.pop();
  while (after.length > 0 && after[0].trim() === "") after.shift();

  const result = after.length > 0 ? [...before, "", ...after] : before;
  return `${result.join("\n").trimEnd()}\n`;
}

/**
 * Extract markdown heading text (without the `#` prefix) from a heading line.
 * Normalizes by trimming whitespace and converting to lowercase for comparison.
 * Returns undefined if the line is not a heading.
 */
function parseHeading(line: string): { level: number; normalized: string } | undefined {
  const match = line.match(/^(#{2,6})\s+(.+)/);
  if (!match) return undefined;
  return { level: match[1].length, normalized: match[2].trim().toLowerCase() };
}

/**
 * Extract all heading texts from markdown content, normalized for comparison.
 * Only extracts H2–H6 headings (H1 is the document title, not a section).
 */
export function extractHeadings(content: string): Set<string> {
  const headings = new Set<string>();
  for (const line of content.split("\n")) {
    const parsed = parseHeading(line);
    if (parsed) headings.add(parsed.normalized);
  }
  return headings;
}

/**
 * Remove sections from instructions whose heading also appears in managed rules.
 * Removes the heading line and all content up to (but not including) the next
 * heading at the same or higher level. Preserves sections unique to the template.
 */
export function deduplicateByHeading(instructions: string, managedRules: string): string {
  if (!managedRules.trim()) return instructions;

  const rulesHeadings = extractHeadings(managedRules);
  if (rulesHeadings.size === 0) return instructions;

  const lines = instructions.split("\n");
  const result: string[] = [];
  let skipping = false;
  let skipLevel = 0;

  for (const line of lines) {
    const parsed = parseHeading(line);

    if (parsed) {
      if (skipping && parsed.level <= skipLevel) {
        // Hit a same-or-higher-level heading — stop skipping
        skipping = false;
      }

      if (!skipping && rulesHeadings.has(parsed.normalized)) {
        // This heading is duplicated in managed rules — start skipping
        skipping = true;
        skipLevel = parsed.level;
        continue;
      }
    }

    if (!skipping) {
      result.push(line);
    }
  }

  // Clean up trailing blank lines from removed sections
  return result.join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * Build the target file content by merging the instructions template with any
 * existing content. Uses instruction markers to wrap the template section so
 * user content outside the markers is preserved. Also preserves any managed
 * rules section written by syncRules.
 */
export function mergeInstructionsWithManagedSection(
  instructionsContent: string,
  existingFileContent: string | undefined,
): string {
  if (!existingFileContent) {
    const wrappedInstructions = `${INSTRUCTIONS_START}\n${instructionsContent.trimEnd()}\n${INSTRUCTIONS_END}`;
    return `${wrappedInstructions}\n`;
  }

  // Preserve any managed rules section
  const managed = extractManagedSection(existingFileContent);
  const managedBlock = managed ? `\n\n${wrapManaged(managed)}` : "";

  // Deduplicate: remove template sections whose headings also appear in managed rules
  const dedupedContent = managed ? deduplicateByHeading(instructionsContent, managed) : instructionsContent;
  const wrappedInstructions = `${INSTRUCTIONS_START}\n${dedupedContent.trimEnd()}\n${INSTRUCTIONS_END}`;

  // If instruction markers already exist, replace only that section
  const startIdx = indexOfMarkerAtLineStart(existingFileContent, INSTRUCTIONS_START);
  const endIdx = indexOfMarkerAtLineStart(existingFileContent, INSTRUCTIONS_END);
  if (startIdx !== -1 && endIdx !== -1) {
    const before = existingFileContent.slice(0, startIdx);
    const afterEnd = endIdx + INSTRUCTIONS_END.length;
    // Everything after instruction markers but before managed rules markers (if any)
    let after = existingFileContent.slice(afterEnd);
    // Strip the old managed section from "after" — we'll re-append the fresh one
    const managedStartInAfter = indexOfMarkerAtLineStart(after, MANAGED_START_MARKER);
    if (managedStartInAfter !== -1) {
      after = after.slice(0, managedStartInAfter);
    }
    return `${before}${wrappedInstructions}${after.trimEnd()}${managedBlock}\n`;
  }

  // No instruction markers yet — first deployment.
  // Strip the existing managed section from the body before re-appending the
  // fresh `managedBlock`. Without this, when rules-sync ran first (the post-
  // `sync-idempotent-and-complete` ordering) the existing file already contains
  // a managed block and we'd duplicate it on the way out.
  const bodyWithoutManaged = stripManagedSection(existingFileContent);

  // If the file already has content from a pre-marker era (template was deployed
  // without markers), check if it starts with the template. If so, replace it.
  // Otherwise, prepend the template and keep existing content.
  if (isInstructionsUpToDate(bodyWithoutManaged, instructionsContent)) {
    // File starts with the old template — replace with marked version
    return `${wrappedInstructions}${managedBlock}\n`;
  }

  // File has user-only content (no template deployed before).
  // Prepend the template and keep everything (minus the managed block, which
  // we re-append from `managedBlock` so its position stays canonical).
  return `${wrappedInstructions}\n\n${bodyWithoutManaged.trimEnd()}${managedBlock}\n`;
}

/**
 * Remove the managed-rules block (markers and content) from a file body so
 * `mergeInstructionsWithManagedSection` can re-append a fresh `managedBlock`
 * without duplicating it. Returns the original body when no managed section
 * is present.
 */
function stripManagedSection(fileContent: string): string {
  const startIdx = indexOfMarkerAtLineStart(fileContent, MANAGED_START_MARKER);
  const endIdx = indexOfMarkerAtLineStart(fileContent, MANAGED_END_MARKER);
  if (startIdx === -1 || endIdx === -1) return fileContent;
  const before = fileContent.slice(0, startIdx);
  const afterEnd = endIdx + MANAGED_END_MARKER.length;
  const after = fileContent.slice(afterEnd);
  return before.trimEnd() + (after ? `\n${after.trimStart()}` : "");
}

/**
 * Check whether the deployed file is up to date with the instructions template.
 * Checks both the new marker format and the legacy format (template at start of file).
 *
 * When the deployed file has a managed rules section, the sync engine applies
 * deduplicateByHeading before writing (see mergeInstructionsWithManagedSection). This
 * check must apply the same transform to avoid false-positive drift on files with
 * overlapping headings between template and managed rules.
 */
export function isInstructionsUpToDate(deployed: string, instructionsContent: string): boolean {
  // New format: check inside instruction markers
  const startIdx = indexOfMarkerAtLineStart(deployed, INSTRUCTIONS_START);
  const endIdx = indexOfMarkerAtLineStart(deployed, INSTRUCTIONS_END);
  if (startIdx !== -1 && endIdx !== -1) {
    const deployedInstructions = deployed.slice(startIdx + INSTRUCTIONS_START.length + 1, endIdx).trimEnd();
    // Apply the same deduplication the sync applies when the file has a managed rules section.
    const managed = extractManagedSection(deployed);
    const expectedInstructions = managed ? deduplicateByHeading(instructionsContent, managed) : instructionsContent;
    return deployedInstructions === expectedInstructions.trimEnd();
  }
  // Legacy format: template at start of file
  return deployed === instructionsContent || deployed.startsWith(instructionsContent.trimEnd());
}
