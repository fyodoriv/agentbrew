import { MAX_JUDGE_INPUT_BYTES } from "./artifact.js";
import { type JudgeSourceContext, receiptSources } from "./receipt-key.js";

export function readJudgeInput(artifact: Uint8Array, sourceContext?: JudgeSourceContext) {
  const sourceIds = sourceContext?.sources.map(({ id }) => id);
  if (
    sourceContext &&
    (sourceContext.request.byteLength === 0 ||
      !sourceIds?.length ||
      new Set(sourceIds).size !== sourceIds.length ||
      sourceIds.some((id) => id === "request" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)))
  ) {
    throw new Error("Judge requires the original request and uniquely named sources.");
  }

  const sources = receiptSources(sourceContext);
  const bytes = (sources ?? []).reduce((size, source) => size + source.bytes.byteLength, artifact.byteLength);
  if (artifact.byteLength === 0 || bytes > MAX_JUDGE_INPUT_BYTES) {
    throw new Error("Judge input is empty or too large.");
  }

  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const context = sourceContext && {
    request: decoder.decode(sourceContext.request),
    sources: sourceContext.sources.map(({ id, bytes }) => ({ id, text: decoder.decode(bytes) })),
  };
  return { text: decoder.decode(artifact), context, sourceIds, sources };
}
