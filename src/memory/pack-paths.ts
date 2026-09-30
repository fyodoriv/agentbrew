import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/** Resolve overlay-relative memory pack paths to absolute directories with pack.yaml. */
export function resolveMemoryPackPaths(baseDir: string, entries: string[]): string[] {
  const resolved: string[] = [];
  for (const entry of entries) {
    const dir = resolve(baseDir, entry);
    if (existsSync(join(dir, "pack.yaml"))) {
      resolved.push(dir);
    }
  }
  return resolved;
}
