import { dirname, isAbsolute, resolve } from "node:path";
import { readJudgeArtifact } from "./artifact.js";
import type { LoadedJudge } from "./load.js";
import type { JudgeSourceContext } from "./receipt-key.js";

export function readDeliveryContexts(
  judges: readonly LoadedJudge[],
  event: LoadedJudge["definition"]["on"][number],
  manifest = process.env.AGENTBREW_JUDGE_CONTEXT_FILE,
): ReadonlyMap<string, JudgeSourceContext> {
  const contexts = new Map<string, JudgeSourceContext>();
  const grounded = judges.filter(
    ({ definition }) => definition.sees === "artifact+sources" && definition.on.includes(event),
  );
  if (!grounded.length || !manifest) return contexts;
  if (!isAbsolute(manifest)) throw new Error("Judge context manifest path must be absolute.");
  const config = JSON.parse(readJudgeArtifact(manifest).toString("utf8")) as Record<string, unknown>;
  const base = dirname(manifest);
  function file(path: unknown): Buffer {
    if (typeof path !== "string" || !path.trim()) throw new Error("Invalid judge context file.");
    return readJudgeArtifact(resolve(base, path));
  }
  for (const { definition } of grounded) {
    if (!config || !Object.hasOwn(config, definition.name)) continue;
    const entry = config[definition.name] as { request?: unknown; sources?: unknown };
    if (!entry || !Array.isArray(entry.sources) || !entry.sources.length) {
      throw new Error("Invalid judge context sources.");
    }
    const sources = entry.sources.map((source: { id?: unknown; file?: unknown }) => {
      if (typeof source?.id !== "string" || source.id === "request" || !/^[a-zA-Z0-9_-]{1,64}$/.test(source.id)) {
        throw new Error("Invalid judge context source ID.");
      }
      return { id: source.id, bytes: file(source.file) };
    });
    if (new Set(sources.map(({ id }) => id)).size !== sources.length)
      throw new Error("Duplicate judge context sources.");
    contexts.set(definition.name, { request: file(entry.request), sources });
  }
  return contexts;
}
