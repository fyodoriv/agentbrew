import { createHash } from "node:crypto";
import { closeSync, fsyncSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { fileURLToPath } from "node:url";

const MODEL_DIGEST = "31d9857b5705086d352d4d6db04e86c5d0f6a2b5d59a4dc7ce5cdb271ccf9141";
const CASES_DIGEST = "ce8183d0cd5ed1b6c38564c7c1d023dd6eba55a7319f3c36ef1c8e20ea6561f6";
const PROTOCOL_DIGEST = "6aa8a467e6c406f9ff52c3f0bd21c07169428ebb71cf7bc84f5aa46c675ac6f9";
const METADATA_HELPER_DIGEST = "612adc6581b6d96a09f0cc21fa6a49c1824e8e9e32ae953029b9285bf1fcddf3";
const CASES_FILE = new URL("chat-followup-cases-821.json", import.meta.url);
const PROTOCOL_FILE = new URL("chat-rule-schema-protocol.mjs", import.meta.url);
const METADATA_HELPER_FILE = new URL("eval-chat-message-rule-821.mjs", import.meta.url);
const METADATA_URL = "http://127.0.0.1:11434/api/tags";
const GENERATION_URL = "http://127.0.0.1:11434/api/chat";
const MAX_RESPONSE_BYTES = 64 * 1024;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function localTransport(url, options) {
  if (url !== METADATA_URL && url !== GENERATION_URL) throw new Error("Unexpected model endpoint");
  const signal = AbortSignal.timeout(url === METADATA_URL ? 10_000 : 60_000);
  return new Promise((resolve, reject) => {
    const outgoing = request(url, { method: options.method, headers: options.headers, signal }, (response) => {
      const chunks = [];
      let count = 0;
      response.on("data", (chunk) => {
        count += chunk.length;
        if (count > MAX_RESPONSE_BYTES) response.destroy(new Error("Model response too large"));
        else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => {
        const data = Buffer.concat(chunks).toString("utf8");
        resolve({
          ok: response.statusCode === 200,
          text: async () => data,
          json: async () => JSON.parse(data),
        });
      });
    });
    outgoing.on("error", reject);
    outgoing.end(options.body);
  });
}

export async function baseline(receiptPath, runnerDigest, readModelDigest, decide) {
  const casesBytes = readFileSync(CASES_FILE);
  if (
    !/^[a-f0-9]{64}$/.test(runnerDigest) ||
    sha256(readFileSync(new URL(import.meta.url))) !== runnerDigest ||
    sha256(casesBytes) !== CASES_DIGEST ||
    sha256(readFileSync(PROTOCOL_FILE)) !== PROTOCOL_DIGEST ||
    sha256(readFileSync(METADATA_HELPER_FILE)) !== METADATA_HELPER_DIGEST
  ) {
    throw new Error("Frozen inputs changed");
  }

  const cases = JSON.parse(casesBytes);
  const receipt = openSync(receiptPath, "wx", 0o600);
  try {
    if ((await readModelDigest()) !== MODEL_DIGEST) throw new Error("Model digest changed");
    const records = [];
    for (const item of cases) {
      const prompt = [
        "You are choosing how to add a follow-up in a chat.",
        item.context,
        "Choose EDIT to edit your existing message. Choose POST to send another message. Choose HOLD to wait until a safe route is available. Return the action in the requested JSON format.",
      ].join("\n");
      const actual = await decide(prompt);
      if (!["EDIT", "POST", "HOLD"].includes(actual)) throw new Error("Invalid decision");
      records.push({ id: item.id, expected: item.expected, actual });
    }
    if ((await readModelDigest()) !== MODEL_DIGEST) throw new Error("Model digest changed");
    const correct = records.filter(({ actual, expected }) => actual === expected).length;
    const result = {
      model: "qwen3:4b",
      modelDigest: MODEL_DIGEST,
      runnerDigest,
      casesDigest: CASES_DIGEST,
      protocolDigest: PROTOCOL_DIGEST,
      metadataHelperDigest: METADATA_HELPER_DIGEST,
      correct,
      records,
    };
    writeFileSync(receipt, `${JSON.stringify(result)}\n`);
    fsyncSync(receipt);
    return { correct, total: records.length };
  } finally {
    closeSync(receipt);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [receipt, runnerDigest] = process.argv.slice(2);
    if (process.argv.length !== 4 || !receipt) throw new Error("Expected receipt and runner digest");
    const result = await baseline(
      receipt,
      runnerDigest,
      async () => (await import(METADATA_HELPER_FILE.href)).modelDigest(localTransport),
      async (prompt) => (await import(PROTOCOL_FILE.href)).requestDecision(prompt, localTransport),
    );
    console.log(JSON.stringify(result));
  } catch {
    console.error("Chat follow-up baseline unavailable. Keep its receipt.");
    process.exitCode = 1;
  }
}
