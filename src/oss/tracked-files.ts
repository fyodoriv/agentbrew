import { execFileSync } from "node:child_process";

export function listTrackedFiles(root: string): string[] {
  return [
    ...new Set(
      execFileSync("git", ["ls-files", "-z"], {
        cwd: root,
        stdio: "pipe",
        maxBuffer: 64 * 1024 * 1024,
      })
        .toString()
        .split("\0")
        .filter(Boolean),
    ),
  ].sort();
}
