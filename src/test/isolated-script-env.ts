import { dirname } from "node:path";

/** PATH for script tests — avoids dotfiles/bin/gh shadowing fixture binaries. */
export function isolatedScriptPath(fakeBinDir: string): string {
  const nodeDir = dirname(process.execPath);
  return [fakeBinDir, nodeDir, "/usr/bin", "/bin"].join(":");
}

/** spawn/exec env that keeps HOME but isolates PATH from shell profile hooks. */
export function isolatedScriptEnv(fakeBinDir: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    HOME: process.env.HOME ?? "/tmp",
    PATH: isolatedScriptPath(fakeBinDir),
    BASH_ENV: "",
    ENV: "",
    ...extra,
  };
}
