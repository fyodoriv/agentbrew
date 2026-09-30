import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// ── Constants ────────────────────────────────────────────────────────────────

// Offline ~4-chars-per-token heuristic (GPT-family). Good enough for a budget
// signal without a tokenizer dependency. Thresholds are tuned generously so no
// legitimate current skill errors on day one — the error cap only fires on a
// SKILL.md that has clearly outgrown progressive disclosure.
const CHARS_PER_TOKEN = 4;
const TOKEN_WARN = 6000;
const TOKEN_ERROR = 16000;

type StructuralSeverity = "error" | "warning";

interface StructuralIssue {
  severity: StructuralSeverity;
  message: string;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** Rough offline token estimate for a chunk of text. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Extract local (relative) markdown link targets from SKILL.md content.
 * Skips external schemes (http/https/mailto/tel), in-page anchors (`#…`), and
 * absolute paths (`/…`) — those can't be resolved against the skill directory.
 * Strips link titles (`(path "title")`) and trailing `#fragment`.
 */
export function extractRelativeLinks(content: string): string[] {
  const links = new Set<string>();
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    let target = match[1].trim().split(/\s+/)[0];
    if (!target || /^(?:https?:|mailto:|tel:|#)/i.test(target) || target.startsWith("/")) continue;
    target = target.replace(/#.*$/, "");
    if (!target) continue;
    // Skip prose placeholders / non-path tokens: angle-bracket or regex/glob
    // metacharacters (`<NAME>`, `[^/]+`), or a bare word with no path separator
    // and no file extension (the literal `url` in `[link](url)`).
    if (/[<>[\]|^*$`]/.test(target)) continue;
    if (!target.includes("/") && !/\.[a-z0-9]+$/i.test(target)) continue;
    links.add(target);
  }
  return [...links];
}

/**
 * Check a skill's SKILL.md for broken relative links and oversized context.
 * Resolves relative links against the skill directory. Returns issues; callers
 * decide how to surface them (this is intentionally NOT wired into validateSkill
 * so lint/drift behaviour is unchanged — same pattern as validateEvals).
 */
export function checkSkillStructure(skillDir: string): StructuralIssue[] {
  const skillMdPath = join(skillDir, "SKILL.md");
  if (!existsSync(skillMdPath)) return [];
  const content = readFileSync(skillMdPath, "utf-8");
  const issues: StructuralIssue[] = [];

  // Link resolution is a WARNING, not an error: skill markdown legitimately
  // contains illustrative file paths in prose, and relative links shift when a
  // skill is deployed via symlink to ~/.*/skills/. We surface candidates but
  // never gate on them. The token hard-cap below is the only structural error.
  for (const target of extractRelativeLinks(content)) {
    if (!existsSync(resolve(dirname(skillMdPath), target))) {
      issues.push({ severity: "warning", message: `Broken relative link: ${target}` });
    }
  }

  const tokens = estimateTokens(content);
  if (tokens > TOKEN_ERROR) {
    issues.push({ severity: "error", message: `SKILL.md ~${tokens} tokens exceeds hard cap ${TOKEN_ERROR}` });
  } else if (tokens > TOKEN_WARN) {
    issues.push({ severity: "warning", message: `SKILL.md ~${tokens} tokens over budget ${TOKEN_WARN}` });
  }

  return issues;
}
