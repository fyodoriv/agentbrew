import { execFileSync } from "node:child_process";

/** Read the major version from V1 (`1.19.5`) and V2 (`opencode v2.2.6`) output. */
export function opencodeMajorFromVersion(version: string): 1 | 2 {
  const match = version.match(/(?:^|\s)v?(\d+)\./);
  if (!match) throw new Error("Unrecognized OpenCode version output");
  const major = Number(match[1]);
  if (major !== 1 && major !== 2) throw new Error(`Unsupported OpenCode major version: ${major}`);
  return major;
}

/** Ask the installed OpenCode binary which plugin and config API it supports. */
export function readOpencodeMajor(timeout: number): 1 | 2 {
  return opencodeMajorFromVersion(execFileSync("opencode", ["--version"], { encoding: "utf8", timeout }));
}
