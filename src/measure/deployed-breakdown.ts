/**
 * Where the always-loaded rules file comes from (#518): split the deployed
 * file (for example ~/.claude/CLAUDE.md) by agentbrew's markers, give each
 * source its share, and list long lines that appear in two sources.
 */

export type DeployedSource =
  | "agentbrew instructions"
  | "personal (outside markers)"
  | "shared rules"
  | "catalog rules"
  | "team rules";

export interface DeployedSourceSize {
  source: DeployedSource;
  chars: number;
  tokens: number;
  sharePct: number;
  /** Catalog rule ids or team rule owners in this source. */
  blocks: string[];
}

export interface DeployedDuplicate {
  text: string;
  sources: DeployedSource[];
}

export interface DeployedBreakdown {
  totalChars: number;
  sources: DeployedSourceSize[];
  duplicates: DeployedDuplicate[];
}

/** Shorter lines repeat by chance (headings, list stems); skip them. */
const MIN_DUPLICATE_CHARS = 40;

const MARKER = /^<!--\s*(.+?)\s*-->$/;

/** The source that text after a marker line belongs to, or undefined for a marker that changes nothing. */
function sourceAfter(marker: string, inAgentbrew: boolean): { source: DeployedSource; block?: string } | undefined {
  if (marker === "agentbrew:instructions:start") return { source: "agentbrew instructions" };
  if (marker === "agentbrew:instructions:end" || marker === "agentbrew:end") {
    return { source: "personal (outside markers)" };
  }
  if (marker === "agentbrew:start") return { source: "shared rules" };
  const rule = marker.match(/^rule:\s*(\S+)$/);
  if (rule) return { source: "catalog rules", block: rule[1] };
  const team = marker.match(/^agentfile-rules:\s*(\S+)$/);
  if (team) return { source: "team rules", block: team[1] };
  if (marker.startsWith("/agentfile-rules")) {
    return { source: inAgentbrew ? "shared rules" : "personal (outside markers)" };
  }
  return undefined;
}

interface TaggedLine {
  source: DeployedSource;
  /** Set on the first line after a rule or team marker. */
  block?: string;
  text: string;
}

/** Walk the file and tag each non-empty, non-marker line with its source. */
function tagLines(text: string): TaggedLine[] {
  const tagged: TaggedLine[] = [];
  let current: DeployedSource = "personal (outside markers)";
  let pendingBlock: string | undefined;
  let inAgentbrew = false;
  let previousBlank = false;
  for (const line of text.split("\n")) {
    const marker = line.trim().match(MARKER)?.[1];
    if (marker) {
      if (marker === "agentbrew:start" || marker === "agentbrew:end") inAgentbrew = marker === "agentbrew:start";
      const next = sourceAfter(marker, inAgentbrew);
      if (next) [current, pendingBlock] = [next.source, next.block];
      previousBlank = false;
      continue;
    }
    // A catalog rule block ends at the next heading after a blank line.
    if (current === "catalog rules" && previousBlank && line.startsWith("#")) current = "shared rules";
    previousBlank = line.trim() === "";
    if (previousBlank) continue;
    tagged.push({ source: current, block: pendingBlock, text: line });
    pendingBlock = undefined;
  }
  return tagged;
}

function findDuplicates(tagged: TaggedLine[]): DeployedDuplicate[] {
  const seen = new Map<string, Set<DeployedSource>>();
  for (const { source, text } of tagged) {
    const key = text.trim();
    if (key.length < MIN_DUPLICATE_CHARS) continue;
    seen.set(key, (seen.get(key) ?? new Set<DeployedSource>()).add(source));
  }
  return [...seen.entries()]
    .filter(([, sources]) => sources.size > 1)
    .map(([text, sources]) => ({ text, sources: [...sources].sort() }));
}

export function breakdownDeployedRules(text: string): DeployedBreakdown {
  const tagged = tagLines(text);
  const chars = new Map<DeployedSource, number>();
  const blocks = new Map<DeployedSource, string[]>();
  for (const { source, block, text: line } of tagged) {
    chars.set(source, (chars.get(source) ?? 0) + line.length + 1);
    if (block) blocks.set(source, [...(blocks.get(source) ?? []), block]);
  }
  const totalChars = [...chars.values()].reduce((sum, n) => sum + n, 0);
  const sources = [...chars.entries()]
    .map(([source, n]) => ({
      source,
      chars: n,
      tokens: Math.ceil(n / 4),
      sharePct: totalChars === 0 ? 0 : Math.round((n / totalChars) * 1000) / 10,
      blocks: blocks.get(source) ?? [],
    }))
    .sort((a, b) => b.chars - a.chars);
  return { totalChars, sources, duplicates: findDuplicates(tagged) };
}
