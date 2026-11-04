import { createHash } from "node:crypto";
import { posix, resolve } from "node:path";
import type { Agentfile } from "../agentfile.js";
import { type JudgeDefinition, parseJudgeDefinition } from "./definition.js";
import { readJudgeSource } from "./source.js";

export interface LoadedJudge {
  owner: string;
  path: string;
  sha256: string;
  definition: JudgeDefinition;
}

export function loadJudgeDefinitions(
  agentfile: Pick<Agentfile, "judges" | "judgeSources">,
  baseDir: string,
): LoadedJudge[] {
  const sources = [{ owner: resolve(baseDir), paths: agentfile.judges ?? [] }, ...(agentfile.judgeSources ?? [])];
  const judges = new Map<string, LoadedJudge>();
  for (const { owner, paths } of sources) {
    for (const path of paths) {
      const name = posix.basename(path, ".md");
      if (judges.has(name)) throw new Error(`Duplicate judge name: ${JSON.stringify(name)}`);
      const content = readJudgeSource(owner, path);
      judges.set(name, {
        owner,
        path,
        sha256: createHash("sha256").update(content).digest("hex"),
        definition: parseJudgeDefinition(name, content),
      });
    }
  }
  return [...judges.values()];
}
