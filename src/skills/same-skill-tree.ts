import { lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";

/** Compare entry names, modes, and bytes without following symlinks. */
export function sameSkillTree(a: string, b: string, options: { compareSymlinkTargets?: boolean } = {}): boolean {
  const left = lstatSync(a, { throwIfNoEntry: false });
  const right = lstatSync(b, { throwIfNoEntry: false });
  if (!left || !right) return false;
  if (left.isSymbolicLink() || right.isSymbolicLink()) {
    return (
      options.compareSymlinkTargets !== false &&
      left.isSymbolicLink() &&
      right.isSymbolicLink() &&
      readlinkSync(a) === readlinkSync(b)
    );
  }
  if (left.isDirectory() !== right.isDirectory()) return false;
  if (!left.isDirectory()) {
    return (
      left.isFile() &&
      right.isFile() &&
      left.size === right.size &&
      left.mode === right.mode &&
      readFileSync(a).equals(readFileSync(b))
    );
  }
  const names = readdirSync(a).sort();
  const other = readdirSync(b).sort();
  if (names.length !== other.length || names.some((name, i) => name !== other[i])) return false;
  return names.every((name) => sameSkillTree(join(a, name), join(b, name), options));
}
