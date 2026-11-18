import { cpSync, existsSync, lstatSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

export function projectSkillRelativePath(skillName: string): string {
  return join(".agentbrew", "skills", skillName);
}

/** Copy and register skill files. Protected installs own only a new leaf for this invocation. */
export function copySkillDirectory(
  source: string,
  destination: string,
  preserveExisting = false,
  register?: () => void,
): boolean {
  if (!preserveExisting) {
    if (existsSync(destination)) rmSync(destination, { recursive: true, force: true });
    mkdirSync(destination, { recursive: true });
    cpSync(source, destination, { recursive: true });
    register?.();
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
    register?.();
  } catch (error) {
    const current = lstatSync(destination, { throwIfNoEntry: false });
    if (current?.dev === created.dev && current.ino === created.ino) {
      rmSync(destination, { recursive: true, force: true });
    }
    throw error;
  }
  return true;
}
