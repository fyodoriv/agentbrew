import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdtemp, open, readFile, realpath, rmdir, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { requestDecision } from "./chat-rule-schema-protocol.mjs";

// Synthetic controls only. Caller-supplied bindings, hooks and transport do not
// authorize or enforce the separately registered live experiment.
const prefix = "You are choosing how to add a follow-up in a chat. ";
const suffix = "Choose exactly one action: EDIT, POST, or HOLD.";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const unavailable = () => new Error("Chat schema experiment unavailable");

function safeStat(st, expectedSize) {
  return (
    st.isFile() &&
    st.uid === process.getuid?.() &&
    (st.mode & 0o077) === 0 &&
    st.nlink === 1 &&
    st.size > 0 &&
    st.size <= 64 * 1024 &&
    (expectedSize === undefined || st.size === expectedSize)
  );
}

async function privateBytes(path, expectedSize, transform = (st) => st) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!safeStat(before, expectedSize) || !safeStat(transform(before), expectedSize)) throw unavailable();
    const buffer = Buffer.alloc(before.size + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, bytesRead);
    const after = await handle.stat();
    if (
      !safeStat(after, expectedSize) ||
      !safeStat(transform(after), expectedSize) ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytes.length !== before.size
    )
      throw unavailable();
    return bytes;
  } finally {
    await handle.close();
  }
}

async function privateParent(path) {
  const parent = resolve(dirname(path));
  if ((await realpath(parent)) !== parent) throw unavailable();
  const st = await lstat(parent);
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid?.() || (st.mode & 0o077) !== 0)
    throw unavailable();
  return parent;
}

async function absent(path) {
  try {
    await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw unavailable();
}

async function identity(caseHash, modelDigest) {
  const [runner, schema] = await Promise.all([
    readFile(new URL(import.meta.url)),
    readFile(new URL("./chat-rule-schema-protocol.mjs", import.meta.url)),
  ]);
  return {
    caseHash,
    model: "qwen3:4b",
    modelDigest,
    runnerHash: sha(runner),
    schemaHash: sha(schema),
    templateHash: sha(`${prefix}\0${suffix}`),
    temperature: 0,
  };
}

function validatePins(bindings, pins) {
  if (
    !pins ||
    pins.runnerHash !== bindings.runnerHash ||
    pins.schemaHash !== bindings.schemaHash ||
    pins.templateHash !== bindings.templateHash ||
    !/^[a-f0-9]{64}$/.test(bindings.modelDigest)
  )
    throw unavailable();
}

async function casesFrom(path, caseHash, caseSize, transform) {
  if (!/^[a-f0-9]{64}$/.test(caseHash) || !Number.isInteger(caseSize)) throw unavailable();
  const bytes = await privateBytes(path, caseSize, transform);
  if (sha(bytes) !== caseHash) throw unavailable();
  const data = JSON.parse(bytes.toString("utf8"));
  if (
    !data ||
    !Array.isArray(data.cases) ||
    data.cases.length !== 4 ||
    data.cases.some(
      (item) => !item || typeof item.text !== "string" || !["EDIT", "POST", "HOLD"].includes(item.expected),
    )
  )
    throw unavailable();
  return data.cases;
}

async function probe(transport, expected) {
  const response = await transport("http://127.0.0.1:11434/api/tags", { method: "GET" });
  if (!response.ok) throw unavailable();
  const digest = JSON.parse(await response.text())?.models?.find((item) => item.name === "qwen3:4b")?.digest;
  if (digest !== expected || !/^[a-f0-9]{64}$/.test(digest)) throw unavailable();
}

async function answers(cases, rule, transport) {
  const results = [];
  for (const item of cases) results.push(await requestDecision(`${prefix}${rule}\n${item.text}\n${suffix}`, transport));
  return results;
}

async function publishMarker(parent, receiptPath, text, hooks) {
  const dir = await mkdtemp(join(parent, ".chat-schema-marker-"));
  const directory = await lstat(dir);
  const temporary = join(dir, "marker");
  let markerStat;
  try {
    const marker = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      markerStat = await marker.stat();
      await marker.writeFile(`${sha(text)}\n`);
      await marker.sync();
    } finally {
      await marker.close();
    }
    if (hooks?.beforePublishMarker) await hooks.beforePublishMarker();
    await link(temporary, `${receiptPath}.finalized`);
  } finally {
    try {
      const currentDir = await lstat(dir);
      const currentMarker = await lstat(temporary);
      if (
        currentDir.dev === directory.dev &&
        currentDir.ino === directory.ino &&
        markerStat &&
        currentMarker.dev === markerStat.dev &&
        currentMarker.ino === markerStat.ino
      ) {
        await unlink(temporary);
        await rmdir(dir);
      }
    } catch {
      /* Retain uncertain scratch rather than remove an unowned path. */
    }
  }
}

export async function runBaseline(options) {
  let reservation;
  let outcome;
  let failed = false;
  try {
    const { casePath, caseHash, caseSize, receiptPath, digest, pins, transport, hooks = {} } = options;
    if (typeof transport !== "function") throw unavailable();
    const cases = await casesFrom(casePath, caseHash, caseSize, hooks.caseStat);
    const bindings = await identity(caseHash, digest);
    validatePins(bindings, pins);
    const parent = await privateParent(receiptPath);
    await absent(`${receiptPath}.finalized`);
    reservation = await open(
      receiptPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    if (hooks.afterReservation) await hooks.afterReservation();
    await probe(transport, digest);
    const result = await answers(cases, "", transport);
    await probe(transport, digest);
    const text = `${JSON.stringify({ version: 1, bindings, expected: cases.map((item) => item.expected), answers: result })}\n`;
    await reservation.writeFile(text);
    if (hooks.beforeReceiptSync) await hooks.beforeReceiptSync();
    await reservation.sync();
    await reservation.close();
    reservation = undefined;
    await publishMarker(parent, receiptPath, text, hooks);
    outcome = {
      receiptHash: sha(text),
      correct: result.filter((item, index) => item === cases[index].expected).length,
    };
  } catch {
    failed = true;
  } finally {
    if (reservation) {
      try {
        await reservation.close();
      } catch {
        failed = true;
      }
    }
  }
  if (failed) throw unavailable();
  return outcome;
}

export async function runCandidate(options) {
  try {
    const {
      casePath,
      caseHash,
      caseSize,
      receiptPath,
      receiptHash,
      digest,
      pins,
      rule,
      ruleHash,
      transport,
      hooks = {},
    } = options;
    if (
      typeof transport !== "function" ||
      typeof rule !== "string" ||
      !rule ||
      sha(rule) !== ruleHash ||
      !/^[a-f0-9]{64}$/.test(receiptHash)
    )
      throw unavailable();
    const cases = await casesFrom(casePath, caseHash, caseSize, hooks.caseStat);
    const bindings = await identity(caseHash, digest);
    validatePins(bindings, pins);
    await privateParent(receiptPath);
    const [receipt, marker] = await Promise.all([privateBytes(receiptPath), privateBytes(`${receiptPath}.finalized`)]);
    if (sha(receipt) !== receiptHash || marker.toString("utf8") !== `${receiptHash}\n`) throw unavailable();
    const record = JSON.parse(receipt.toString("utf8"));
    if (
      record.version !== 1 ||
      JSON.stringify(record.bindings) !== JSON.stringify(bindings) ||
      JSON.stringify(record.expected) !== JSON.stringify(cases.map((item) => item.expected)) ||
      !Array.isArray(record.answers) ||
      record.answers.length !== 4 ||
      record.answers.some((item) => !["EDIT", "POST", "HOLD"].includes(item))
    )
      throw unavailable();
    await probe(transport, digest);
    const result = await answers(cases, rule, transport);
    await probe(transport, digest);
    const baseline = record.answers.filter((item, index) => item === cases[index].expected).length;
    const correct = result.filter((item, index) => item === cases[index].expected).length;
    if (correct !== 4 || correct <= baseline) throw unavailable();
    return { correct, baseline };
  } catch {
    throw unavailable();
  }
}
