import { Agent, type ClientRequest, type IncomingMessage, request } from "node:http";

const REFUSAL = "Judge requires qualified local Ollama 0.40.14.";

export function assertQualifiedOllamaVersion(): Promise<void> {
  return new Promise((resolve, reject) => {
    // This invocation owns its metadata request and direct Agent through cleanup.
    const agent = new Agent({ keepAlive: false });
    let req: ClientRequest | undefined;
    let res: IncomingMessage | undefined;
    let settled = false;
    let ended = false;
    let length = 0;
    const chunks: Buffer[] = [];
    const finish = (accepted = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      res?.destroy();
      req?.destroy();
      agent.destroy();
      if (accepted) resolve();
      else reject(new Error(REFUSAL));
    };
    const timer = setTimeout(() => finish(), 2000);
    try {
      req = request({ hostname: "127.0.0.1", port: 11434, path: "/api/version", method: "GET", agent }, (response) => {
        res = response;
        if (response.statusCode !== 200) {
          finish();
          return;
        }
        response.on("data", (chunk: Buffer) => {
          if (settled) return;
          if (chunk.byteLength > 4096 - length) {
            finish();
            return;
          }
          chunks.push(Buffer.from(chunk));
          length += chunk.byteLength;
        });
        response.once("end", () => {
          ended = true;
          if (settled) return;
          try {
            const value: unknown = JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, length)),
            );
            finish(
              !!value &&
                typeof value === "object" &&
                !Array.isArray(value) &&
                (value as { version?: unknown }).version === "0.40.14",
            );
          } catch {
            finish();
          }
        });
        response.once("error", () => finish());
        response.once("aborted", () => finish());
        response.once("close", () => {
          if (!ended) finish();
        });
      });
      req.once("error", () => finish());
      req.end();
    } catch {
      finish();
    }
  });
}
