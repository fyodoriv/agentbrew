#!/usr/bin/env node
import { createHash } from "node:crypto";
import { link, lstat, mkdtemp, open, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import yaml from "js-yaml";

export const cases = [
  {
    name: "recent own message",
    context: "In the same channel, your last message was 2 hours ago; nobody has posted since. Editing is available.",
    expected: "EDIT",
  },
  {
    name: "older own message",
    context: "In the same channel, your last message was 25 hours ago; nobody has posted since. Editing is available.",
    expected: "POST",
  },
  {
    name: "intervening message",
    context: "In the same channel, another person posted after your message 2 hours ago. Editing is available.",
    expected: "POST",
  },
  {
    name: "editing unavailable",
    context:
      "In the same channel, your last message was 2 hours ago; nobody has posted since. Editing is unavailable and nobody approved deletion.",
    expected: "HOLD",
  },
];

export async function evaluate(rule, request) {
  const results = [];
  for (const item of cases) {
    const prompt = `You are choosing how to add a follow-up in a chat. ${rule}\n${item.context}\nChoose exactly one action: EDIT (edit your existing message), POST (post another message), or HOLD (do neither until a safe route is available). Reply with just EDIT, POST, or HOLD.`;
    const response = await request(prompt);
    const actual = typeof response === "string" ? response.trim() : "";
    if (!["EDIT", "POST", "HOLD"].includes(actual)) throw new Error(`Invalid response for ${item.name}`);
    results.push({ ...item, actual, correct: actual === item.expected });
  }
  return results;
}

export async function requestModel(prompt, transport = fetch) {
  const response = await transport("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "qwen3:4b",
      stream: false,
      think: false,
      options: { temperature: 0 },
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`Local model returned HTTP ${response.status}`);
  return (await response.json()).message?.content;
}

function report(label, results) {
  for (const result of results) console.log(`${label} ${result.name}: ${result.actual} (expected ${result.expected})`);
  const count = results.filter((result) => result.correct).length;
  console.log(`${label}: ${count}/${results.length}`);
  return count;
}

export async function modelDigest(transport = fetch) {
  const response = await transport("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Local model list returned HTTP ${response.status}`);
  const models = (await response.json()).models;
  const digest = models?.find((model) => model.name === "qwen3:4b")?.digest;
  if (!/^[a-f0-9]{64}$/.test(digest ?? "")) throw new Error("Local model digest unavailable");
  return digest;
}

export async function stableCohort(rule, digest, request, readDigest) {
  const results = await evaluate(rule, request);
  if ((await readDigest()) !== digest) throw new Error("Model changed during the cohort");
  return results;
}

export function makeReceipt(results, digest, harness) {
  return (
    JSON.stringify({
      model: "qwen3:4b",
      digest,
      harness,
      temperature: 0,
      cases,
      answers: results.map((item) => item.actual),
    }) + "\n"
  );
}

export function readReceipt(text, expectedHash, digest, harness) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash ?? "")) throw new Error("A baseline SHA-256 is required");
  if (createHash("sha256").update(text).digest("hex") !== expectedHash) throw new Error("Baseline hash mismatch");
  const receipt = JSON.parse(text);
  if (
    receipt.model !== "qwen3:4b" ||
    !/^[a-f0-9]{64}$/.test(digest ?? "") ||
    receipt.digest !== digest ||
    !/^[a-f0-9]{64}$/.test(harness ?? "") ||
    receipt.harness !== harness ||
    receipt.temperature !== 0 ||
    JSON.stringify(receipt.cases) !== JSON.stringify(cases)
  ) {
    throw new Error("Baseline identity mismatch");
  }
  if (
    !Array.isArray(receipt.answers) ||
    receipt.answers.length !== cases.length ||
    receipt.answers.some((answer) => !["EDIT", "POST", "HOLD"].includes(answer))
  )
    throw new Error("Invalid baseline answers");
  return cases.map((item, index) => ({
    ...item,
    actual: receipt.answers[index],
    correct: receipt.answers[index] === item.expected,
  }));
}

export function checkThreshold(baseline, candidate) {
  if (candidate !== cases.length || candidate <= baseline)
    throw new Error("Candidate did not meet the registered threshold");
}

async function assertNoFinalizationMarker(receiptPath) {
  try {
    await lstat(`${receiptPath}.finalized`);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error("Baseline finalization marker already exists");
}

async function publishFinalizationMarker(receiptPath, text) {
  const dir = await mkdtemp(join(dirname(receiptPath), ".chat-rule-marker-"));
  try {
    const temporary = join(dir, "marker");
    const marker = await open(temporary, "wx", 0o600);
    try {
      await marker.writeFile(`${createHash("sha256").update(text).digest("hex")}\n`);
      await marker.sync();
    } finally {
      await marker.close();
    }
    await link(temporary, `${receiptPath}.finalized`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function readFinalizedReceipt(receiptPath) {
  try {
    const [text, marker] = await Promise.all([
      readFile(receiptPath, "utf8"),
      readFile(`${receiptPath}.finalized`, "utf8"),
    ]);
    const hash = createHash("sha256").update(text).digest("hex");
    if (marker !== `${hash}\n`) throw new Error("marker mismatch");
    return text;
  } catch {
    throw new Error("Baseline receipt is not finalized");
  }
}

async function main() {
  const [mode, receiptPath, expectedHash] = process.argv.slice(2);
  if (!receiptPath || !["--baseline", "--candidate"].includes(mode))
    throw new Error("Use --baseline RECEIPT or --candidate RECEIPT SHA256");
  const catalog = yaml.load(await readFile(new URL("../src/catalog.yaml", import.meta.url), "utf8"));
  const rule = catalog.rules?.find((entry) => entry.name === "merge-recent-chat-messages")?.content;
  const harness = createHash("sha256")
    .update(await readFile(new URL(import.meta.url)))
    .digest("hex");
  if (mode === "--baseline") {
    if (rule) throw new Error("Baseline must be recorded before the candidate rule exists");
    const reservation = await open(receiptPath, "wx", 0o600);
    let results;
    let text;
    try {
      await assertNoFinalizationMarker(receiptPath);
      const digest = await modelDigest();
      results = await stableCohort("", digest, requestModel, modelDigest);
      text = makeReceipt(results, digest, harness);
      await reservation.writeFile(text);
      await reservation.sync();
      await publishFinalizationMarker(receiptPath, text);
    } finally {
      await reservation.close();
    }
    report("baseline", results);
    console.log(`baseline sha256: ${createHash("sha256").update(text).digest("hex")}`);
    return;
  }
  const finalized = await readFinalizedReceipt(receiptPath);
  const digest = await modelDigest();
  const baseline = report("baseline", readReceipt(finalized, expectedHash, digest, harness));
  if (typeof rule !== "string" || !rule.trim()) throw new Error("Candidate rule is missing");
  const candidate = report("candidate", await stableCohort(rule, digest, requestModel, modelDigest));
  checkThreshold(baseline, candidate);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
