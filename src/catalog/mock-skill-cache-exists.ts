import { join } from "node:path";
import type { MockInstance } from "vitest";

type ExistsSyncFn = (path: import("node:fs").PathLike) => boolean;

/**
 * Mock existsSync so findSkillDirInCache(cachePath, skillName) resolves the skill dir.
 * Supports flat and skills/ nested layouts used by install tests.
 */
export function mockSkillCacheExists(
  existsSpy: MockInstance<ExistsSyncFn>,
  cachePath: string,
  skillName: string,
  extra?: (path: string) => boolean | undefined,
): void {
  existsSpy.mockImplementation((path) => {
    const normalized = String(path);
    const extraResult = extra?.(normalized);
    if (extraResult !== undefined) return extraResult;
    if (normalized === cachePath) return true;
    const flatDir = join(cachePath, skillName);
    const nestedDir = join(cachePath, "skills", skillName);
    if (normalized === flatDir || normalized === nestedDir) return true;
    if (
      normalized === join(flatDir, "SKILL.md") ||
      normalized === join(flatDir, "DESIGN.md") ||
      normalized === join(nestedDir, "SKILL.md") ||
      normalized === join(nestedDir, "DESIGN.md")
    ) {
      return true;
    }
    return false;
  });
}
