import { resolve } from "node:path";

export const USER_FACING_AGENT_COUNT_FILES = [
  "README.md",
  "VISION.md",
  "MILESTONES.md",
  "docs/COMPETITION.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "src/catalog.yaml",
  "package.json",
] as const;

const GENERATED_SECTION_START = /^<!-- [\w-]+:start -->$/u;
const GENERATED_SECTION_END = /^<!-- [\w-]+:end -->$/u;
const ALLOWLIST_REASON = /agent-count-allowlist:\s*\S/iu;

const AGENT_COUNT_CLAIM = /\b\d+\+?\s+agents?\b/giu;

const AGENTBREW_SELF_INVENTORY_SNIPPET =
  /\b(?:agentbrew's|AgentBrew's)\s+\d+\+(?:\s+agents?)?|\b(?:agentbrew's|AgentBrew's)\s+\d+\s+agents?\b|\bAgent[Bb]rew covers\s+\d+\+?\s*|\b\d+\+\s+AgentBrew agents\b|\bagentbrew operates across\s+\d+\+?\s+agents?\b|\bagents\.yaml[^)]*\(\d+\+?\s*(?:entries|agents)\)|\b\d+\+\s+pointers\b|\b\d+\+\s+others\b|\bfor \d+\s+exact-name agents\b|\bsplit:\s*\d+\s+exact-name agents\b|\bThe split is \*\*\d+\s+exact-name agents\b|\b\d+\s+of\s+\d+\s+delegated\b|\b\d+\s+client-intersection agents\b|\b\d+\s+strict-intersection\b|\b\d+\s+carve-outs?\s+→\s+native\b|\b\d+\s+carve-outs?\s+stay native\b|\b\d+\+\s+(?:agents|clients?|commands?|rules?|servers?|tools?|entries)\b(?=\s*\|)/giu;

const DELEGATION_INVENTORY =
  /\b\d+\s+of\s+\d+\s+delegated\b|\b\d+\s+client-intersection\s+agents\b|\b\d+\s+strict-intersection(?:\s+\+\s+\d+)?\s+agents\b|\b\d+\s+carve-outs?\s+stay native\b|\b\d+\s+exact-name agents\s+\+\s+\d+\s+rename pairs\b|\bnative for \d+\s+carve-outs\b|\b\d+\s+rename pairs\b.*carve-outs?\b/giu;

const MATRIX_AGENTBREW_INVENTORY = /\b\d+\+?\s+(?:agents?|clients?|commands?|rules?|servers?|harnesses?)\b/giu;

const AGENTBREW_CONTEXT =
  /\bagentbrew(?:'s)?\b|agent definitions across|every AI coding agent|agentbrew install|one cli that syncs/iu;
const TOTAL_AGENT_CONTEXT =
  /\b(?:across|all|every|total|covers|syncs|sync targets|more sync targets|advantage)\b|agentbrew's/iu;

export interface ScanCandidate {
  lineNumber: number;
  line: string;
  scope: string;
}

interface TableScanContext {
  relativePath: string;
  cells: readonly string[];
  line: string;
  lineNumber: number;
  agentbrewColumnIndex: number | undefined;
}

function splitMarkdownTableRow(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    return undefined;
  }
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function isMarkdownSeparatorRow(cells: readonly string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function hasRegexMatch(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

function extractAgentbrewInventorySnippets(text: string): string[] {
  const snippets: string[] = [];
  AGENTBREW_SELF_INVENTORY_SNIPPET.lastIndex = 0;
  for (const match of text.matchAll(AGENTBREW_SELF_INVENTORY_SNIPPET)) {
    snippets.push(match[0]);
  }
  DELEGATION_INVENTORY.lastIndex = 0;
  for (const match of text.matchAll(DELEGATION_INVENTORY)) {
    snippets.push(match[0]);
  }
  return snippets;
}

function shouldScanNarrativeLine(relativePath: string, line: string): boolean {
  if (relativePath === "package.json") {
    return TOTAL_AGENT_CONTEXT.test(line);
  }
  if (relativePath === "MILESTONES.md" || relativePath === "CONTRIBUTING.md") {
    return (
      hasRegexMatch(DELEGATION_INVENTORY, line) ||
      (AGENTBREW_CONTEXT.test(line) && hasRegexMatch(AGENT_COUNT_CLAIM, line))
    );
  }
  if (relativePath === "docs/COMPETITION.md") {
    if (line.trimStart().startsWith(">")) {
      return false;
    }
    if (/^\|\s/.test(line.trim())) {
      return false;
    }
    if (/\*\*AgentBrew advantage:/iu.test(line)) {
      return true;
    }
    return extractAgentbrewInventorySnippets(line).length > 0;
  }
  return AGENTBREW_CONTEXT.test(line) && TOTAL_AGENT_CONTEXT.test(line);
}

function narrativeScanScope(relativePath: string, line: string): string {
  if (relativePath === "docs/COMPETITION.md") {
    const snippets = extractAgentbrewInventorySnippets(line);
    if (snippets.length > 0) {
      return snippets.join(" ");
    }
    if (/\*\*AgentBrew advantage:/iu.test(line)) {
      return line;
    }
    return "";
  }
  return line;
}

function shouldScanAgentbrewTableCell(_cells: readonly string[], agentbrewColumnIndex: number): boolean {
  return agentbrewColumnIndex >= 0;
}

function shouldScanHistoricalGapRow(cells: readonly string[]): boolean {
  return cells.some((cell) => /\bmore sync targets\b/iu.test(cell));
}

function collectNarrativeCandidate(
  candidates: ScanCandidate[],
  relativePath: string,
  line: string,
  lineNumber: number,
): void {
  if (!shouldScanNarrativeLine(relativePath, line)) {
    return;
  }
  const scope = narrativeScanScope(relativePath, line);
  if (scope.trim().length > 0) {
    candidates.push({ lineNumber, line, scope });
  }
}

function collectCompetitionTableCandidates(
  candidates: ScanCandidate[],
  cells: readonly string[],
  line: string,
  lineNumber: number,
  agentbrewColumnIndex: number | undefined,
): void {
  for (const snippet of extractAgentbrewInventorySnippets(cells.join(" "))) {
    candidates.push({ lineNumber, line, scope: snippet });
  }
  if (agentbrewColumnIndex !== undefined && agentbrewColumnIndex < cells.length) {
    candidates.push({ lineNumber, line, scope: cells[agentbrewColumnIndex] ?? "" });
  }
}

function collectGenericTableCandidate(
  candidates: ScanCandidate[],
  cells: readonly string[],
  line: string,
  lineNumber: number,
  agentbrewColumnIndex: number | undefined,
): void {
  if (agentbrewColumnIndex !== undefined && shouldScanAgentbrewTableCell(cells, agentbrewColumnIndex)) {
    candidates.push({ lineNumber, line, scope: cells[agentbrewColumnIndex] ?? "" });
    return;
  }
  if (shouldScanHistoricalGapRow(cells)) {
    candidates.push({ lineNumber, line, scope: cells.join(" ") });
  }
}

function collectTableCandidates(candidates: ScanCandidate[], context: TableScanContext): number | undefined {
  const { relativePath, cells, line, lineNumber, agentbrewColumnIndex } = context;
  const headerAgentbrewIndex = cells.findIndex((cell) => /^agentbrew$/iu.test(cell));
  if (headerAgentbrewIndex !== -1) {
    return headerAgentbrewIndex;
  }
  if (isMarkdownSeparatorRow(cells)) {
    return agentbrewColumnIndex;
  }
  if (relativePath === "docs/COMPETITION.md") {
    collectCompetitionTableCandidates(candidates, cells, line, lineNumber, agentbrewColumnIndex);
  } else {
    collectGenericTableCandidate(candidates, cells, line, lineNumber, agentbrewColumnIndex);
  }
  return agentbrewColumnIndex;
}

export function collectScanCandidates(markdown: string, relativePath: string): ScanCandidate[] {
  const candidates: ScanCandidate[] = [];
  const lines = markdown.split("\n");
  let insideGeneratedSection = false;
  let agentbrewColumnIndex: number | undefined;

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (GENERATED_SECTION_START.test(trimmed)) {
      insideGeneratedSection = true;
      continue;
    }
    if (GENERATED_SECTION_END.test(trimmed)) {
      insideGeneratedSection = false;
      continue;
    }
    if (insideGeneratedSection) {
      continue;
    }

    const lineNumber = index + 1;
    const cells = splitMarkdownTableRow(line);
    if (!cells) {
      agentbrewColumnIndex = undefined;
      collectNarrativeCandidate(candidates, relativePath, line, lineNumber);
      continue;
    }

    agentbrewColumnIndex = collectTableCandidates(candidates, {
      relativePath,
      cells,
      line,
      lineNumber,
      agentbrewColumnIndex,
    });
  }

  return candidates;
}

function hasNearbyAllowlist(lines: readonly string[], lineNumber: number): boolean {
  const index = lineNumber - 1;
  const first = Math.max(0, index - 2);
  const last = Math.min(lines.length - 1, index + 2);
  for (let current = first; current <= last; current += 1) {
    if (ALLOWLIST_REASON.test(lines[current] ?? "")) {
      return true;
    }
  }
  return false;
}

function findClaimsInScope(scope: string): RegExpMatchArray[] {
  const matches: RegExpMatchArray[] = [];
  AGENT_COUNT_CLAIM.lastIndex = 0;
  matches.push(...scope.matchAll(AGENT_COUNT_CLAIM));
  DELEGATION_INVENTORY.lastIndex = 0;
  for (const match of scope.matchAll(DELEGATION_INVENTORY)) {
    matches.push(match);
  }
  AGENTBREW_SELF_INVENTORY_SNIPPET.lastIndex = 0;
  for (const match of scope.matchAll(AGENTBREW_SELF_INVENTORY_SNIPPET)) {
    matches.push(match);
  }
  if (hasRegexMatch(MATRIX_AGENTBREW_INVENTORY, scope) && /\d+\+?\s+(?:agents|clients|commands|rules)/iu.test(scope)) {
    MATRIX_AGENTBREW_INVENTORY.lastIndex = 0;
    for (const match of scope.matchAll(MATRIX_AGENTBREW_INVENTORY)) {
      if (!/^All\b/iu.test(scope) && !/agent matrix/iu.test(scope)) {
        matches.push(match);
      }
    }
  }
  return matches;
}

export function findAgentCountClaims(markdown: string, relativePath: string): string[] {
  const lines = markdown.split("\n");
  return collectScanCandidates(markdown, relativePath)
    .flatMap((candidate) => {
      if (hasNearbyAllowlist(lines, candidate.lineNumber)) {
        return [];
      }
      return findClaimsInScope(candidate.scope).flatMap((match) => {
        const key = match[0];
        return [
          `${relativePath}:${candidate.lineNumber}: agent-count claim "${key}" goes stale — write "every supported agent" or link the agent matrix. For an archived external measurement, add a nearby "<!-- agent-count-allowlist: reason -->" comment.`,
        ];
      });
    })
    .filter((message, index, all) => all.indexOf(message) === index);
}

export function resolveRepoRoot(fromDir = import.meta.dirname): string {
  return resolve(fromDir, "..", "..");
}
