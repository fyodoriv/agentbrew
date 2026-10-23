import { realpathSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { resolve } from "node:path";

/**
 * True when HOME is the real user's home folder. launchd, the user crontab,
 * and the systemd user manager are per user, not per HOME: a job installed
 * from a scratch HOME replaces the real user's job (2026-10-23,
 * `com.agentbrew.check` and the memory daemon).
 */
export function homeIsUsersHome(): boolean {
  return realPath(homedir()) === realPath(userInfo().homedir);
}

function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}
