import { writeSync } from "node:fs";

type Stage =
  | "add"
  | "initial-copy"
  | "release"
  | "update"
  | "updated-copy"
  | "rollback"
  | "rolled-back-copy"
  | "remove"
  | "final-copy";

export function writeObservation(
  record: string,
  write: (fd: number, buffer: Buffer, offset: number, length: number) => number = writeSync,
): void {
  const bytes = Buffer.from(`${record}\n`);
  let offset = 0;
  while (offset < bytes.length) {
    const count = write(2, bytes, offset, bytes.length - offset);
    if (count <= 0) throw new Error("Observation write failed");
    offset += count;
  }
}

function recordFailure(sink: (record: string) => void, record: object): void {
  try {
    sink(JSON.stringify(record));
  } catch {
    // Preserve the original action failure when evidence cannot be written.
  }
}

/** Recorder state belongs to one lifecycle-test invocation. */
export function lifecycleObservation(
  invocation: string,
  sink: (record: string) => void,
  now = () => performance.now(),
) {
  return async <T>(stage: Stage, action: () => T | Promise<T>): Promise<T> => {
    const start = now();
    if (!Number.isFinite(start)) throw new Error("Invalid observation timing");
    sink(JSON.stringify({ invocation, stage, state: "begin", time: start }));
    let result: T;
    try {
      result = await action();
    } catch (error) {
      const end = now();
      const valid = Number.isFinite(end) && end >= start;
      recordFailure(
        sink,
        valid
          ? { invocation, stage, state: "failed", time: end, duration: end - start }
          : { invocation, stage, state: "invalid" },
      );
      throw error;
    }
    const end = now();
    if (!Number.isFinite(end) || end < start) {
      sink(JSON.stringify({ invocation, stage, state: "invalid" }));
      throw new Error("Invalid observation timing");
    }
    sink(JSON.stringify({ invocation, stage, state: "complete", time: end, duration: end - start }));
    return result;
  };
}
