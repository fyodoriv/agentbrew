/** Shared Cursor .mdc frontmatter parsing for measure + bloat lint. */

export interface MdcFrontmatter {
  alwaysApply?: boolean;
  globs?: string[];
  description?: string;
}

/** Globs that match most files when combined with alwaysApply. */
export const ALWAYS_APPLY_BROAD_GLOBS = ["**/*", "**", "**/*.md", "**/**"] as const;

export function parseMdcFrontmatter(raw: string): MdcFrontmatter {
  if (!raw.startsWith("---")) return {};
  const end = raw.indexOf("---", 3);
  if (end === -1) return {};
  const block = raw.slice(3, end);
  const alwaysMatch = /alwaysApply:\s*(true|false)/i.exec(block);
  const alwaysApply = alwaysMatch ? alwaysMatch[1].toLowerCase() === "true" : undefined;
  const descMatch = /description:\s*(.+)/i.exec(block);
  const description = descMatch?.[1]?.trim();
  const globsMatch = /globs:\s*(\[[^\]]*\])/i.exec(block);
  let globs: string[] | undefined;
  if (globsMatch) {
    try {
      globs = JSON.parse(globsMatch[1].replace(/'/g, '"')) as string[];
    } catch {
      globs = undefined;
    }
  }
  return { alwaysApply, globs, description };
}

export function isBroadGlob(glob: string): boolean {
  return (ALWAYS_APPLY_BROAD_GLOBS as readonly string[]).includes(glob);
}

export function isAlwaysApplied(meta: MdcFrontmatter): boolean {
  if (meta.alwaysApply === true) return true;
  if (meta.alwaysApply === false) return false;
  const globs = meta.globs ?? [];
  return globs.some((g) => g === "**/*" || g === "**");
}
