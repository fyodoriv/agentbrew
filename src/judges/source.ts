import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { builtCliRoot } from "../cli-build-health.js";

const MAX_SOURCE_BYTES = 128 * 1024;

export function readJudgeSource(ownerDirectory: string, declaration: string): string {
  try {
    const root = builtCliRoot();
    if (!root || !isAbsolute(ownerDirectory)) throw new Error("expected a built CLI and an absolute owner directory");
    const asset = join(root, "dist", "native", `${process.platform}-${process.arch}`, "judge-source");
    const stat = lstatSync(asset);
    if (!stat.isFile() || (stat.mode & 0o111) === 0) throw new Error("judge reader is unavailable");

    const result = spawnSync(asset, [ownerDirectory, declaration], {
      shell: false,
      timeout: 5000,
      maxBuffer: MAX_SOURCE_BYTES,
    });
    if (result.error || result.status !== 0 || !result.stdout || result.stdout.length > MAX_SOURCE_BYTES) {
      throw new Error("judge reader refused the source");
    }
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(result.stdout);
  } catch {
    throw new Error("Judge source unavailable.");
  }
}
