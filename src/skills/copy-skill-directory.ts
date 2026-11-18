import { cpSync, existsSync, lstatSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";

/** Copy skill files. When preserving, claim a new leaf before writing any files. */
export function copySkillDirectory(source: string, destination: string, preserveExisting = false): boolean {
  if (!preserveExisting) {
    if (existsSync(destination)) rmSync(destination, { recursive: true, force: true });
    mkdirSync(destination, { recursive: true });
    cpSync(source, destination, { recursive: true });
    return true;
  }

  mkdirSync(dirname(destination), { recursive: true });
  try {
    mkdirSync(destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }

  const created = lstatSync(destination);
  try {
    cpSync(source, destination, { recursive: true, force: false, errorOnExist: true });
  } catch (error) {
    const current = lstatSync(destination, { throwIfNoEntry: false });
    if (current?.dev === created.dev && current.ino === created.ino) {
      rmSync(destination, { recursive: true, force: true });
    }
    throw error;
  }
  return true;
}
