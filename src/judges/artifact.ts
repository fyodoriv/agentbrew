import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { resolve } from "node:path";
import type { parseJudgePrArguments } from "./pr-arguments.js";

export const MAX_JUDGE_INPUT_BYTES = 128 * 1024;

export function readJudgeArtifact(path: string): Buffer {
  try {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_JUDGE_INPUT_BYTES) throw new Error();
      const buffer = Buffer.alloc(MAX_JUDGE_INPUT_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const read = readSync(fd, buffer, length, buffer.length - length, null);
        if (read === 0) break;
        length += read;
      }
      if (length > MAX_JUDGE_INPUT_BYTES) throw new Error();
      return buffer.subarray(0, length);
    } finally {
      closeSync(fd);
    }
  } catch {
    throw new Error("Judge artifact must be a readable regular file within the size limit.");
  }
}

type CreateTarget = Extract<ReturnType<typeof parseJudgePrArguments>, { event: "pr-create" }>;

export function readCreateBody(target: CreateTarget, cwd: string): Buffer {
  if (target.bodyFile !== undefined) return readJudgeArtifact(resolve(cwd, target.bodyFile));
  const body = Buffer.from(target.body, "utf8");
  if (body.length > MAX_JUDGE_INPUT_BYTES) throw new Error("Judge artifact exceeds the size limit.");
  return body;
}
