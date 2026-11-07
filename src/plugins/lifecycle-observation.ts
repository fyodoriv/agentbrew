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

/** Recorder state belongs to one lifecycle-test invocation. */
export function lifecycleObservation(
  invocation: string,
  sink: (record: string) => void,
  now = () => performance.now(),
  fallback: (record: string) => void = () => {},
) {
  let degraded = false;
  let active = 0;
  let attempted = false;
  const markUnqualified = () => {
    if (degraded) return;
    degraded = true;
    try {
      fallback("recorder-failed");
    } catch {
      // Health remains unqualified even if both channels fail.
    }
  };
  const emit = (record: object) => {
    try {
      sink(JSON.stringify(record));
    } catch (error) {
      markUnqualified();
      throw error;
    }
  };
  const readClock = () => {
    try {
      return now();
    } catch (error) {
      markUnqualified();
      throw error;
    }
  };
  const begin = (stage: Stage) => {
    const start = readClock();
    if (!Number.isFinite(start)) {
      markUnqualified();
      throw new Error("Invalid observation timing");
    }
    attempted = true;
    active += 1;
    try {
      emit({ invocation, stage, state: "begin", time: start });
    } catch (error) {
      active -= 1;
      throw error;
    }
    return start;
  };
  const fail = (stage: Stage, start: number, error: unknown): never => {
    try {
      const end = readClock();
      const valid = Number.isFinite(end) && end >= start;
      emit(
        valid
          ? { invocation, stage, state: "failed", time: end, duration: end - start }
          : { invocation, stage, state: "invalid" },
      );
      if (!valid) markUnqualified();
    } catch {
      if (!degraded) markUnqualified();
    } finally {
      active -= 1;
    }
    throw error;
  };
  const complete = <T>(stage: Stage, start: number, result: T): T => {
    try {
      const end = readClock();
      if (!Number.isFinite(end) || end < start) {
        markUnqualified();
        emit({ invocation, stage, state: "invalid" });
        throw new Error("Invalid observation timing");
      }
      emit({ invocation, stage, state: "complete", time: end, duration: end - start });
      return result;
    } finally {
      active -= 1;
    }
  };
  const observe = async <T>(stage: Stage, action: () => T | Promise<T>): Promise<T> => {
    const start = begin(stage);
    let result: T;
    try {
      result = await action();
    } catch (error) {
      return fail(stage, start, error);
    }
    return complete(stage, start, result);
  };
  return Object.assign(observe, {
    health: () => (degraded ? "unqualified" : !attempted || active > 0 ? "pending" : "healthy"),
  });
}
