import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { decodeJudgeReceipt, encodeJudgeReceipt, type JudgeReceipt, MAX_JUDGE_RECEIPT_BYTES } from "./receipt.js";

function receiptPath(directory: string, key: string): string {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid judge receipt key.");
  return join(directory, `${key}.jsonl`);
}

export function isPrivateJudgeDirectory(directory: string): boolean {
  const stat = lstatSync(directory, { throwIfNoEntry: false });
  if (!stat) return false;
  if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) {
    throw new Error("Judge receipt directory must be private.");
  }
  return true;
}

/** Keep the latest complete verdict per key in the user's private state directory. */
export function writeJudgeReceipt(directory: string, receipt: JudgeReceipt): void {
  const target = receiptPath(directory, receipt.key);
  const line = encodeJudgeReceipt(receipt);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!isPrivateJudgeDirectory(directory)) throw new Error("Judge receipt directory is unavailable.");
  const stage = mkdtempSync(join(directory, ".receipt-"));
  try {
    const staged = join(stage, "record.jsonl");
    writeFileSync(staged, line, { flag: "wx", mode: 0o600, flush: true });
    renameSync(staged, target);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

export function readJudgeReceipt(directory: string, key: string): JudgeReceipt | undefined {
  const target = receiptPath(directory, key);
  if (!isPrivateJudgeDirectory(directory)) return undefined;
  let fd: number;
  try {
    fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("Judge receipt could not be opened.");
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) {
      throw new Error("Judge receipt must be a private regular file.");
    }
    const buffer = Buffer.alloc(MAX_JUDGE_RECEIPT_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = readSync(fd, buffer, length, buffer.length - length, null);
      if (read === 0) break;
      length += read;
    }
    if (length > MAX_JUDGE_RECEIPT_BYTES) throw new Error("Judge receipt exceeds the size limit.");
    const receipt = decodeJudgeReceipt(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)));
    if (receipt.key !== key) throw new Error("Judge receipt key does not match the requested key.");
    return receipt;
  } finally {
    closeSync(fd);
  }
}
