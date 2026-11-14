import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

type MarkerState = "missing" | "empty" | "nonempty" | "unreadable";

type SafeFlags = { O_NOFOLLOW?: number; O_NONBLOCK?: number };

export function observeMarker(
  path: string,
  flags: SafeFlags = constants,
  open: (path: string, flags: number) => number = openSync,
): MarkerState {
  const { O_NOFOLLOW: nofollow, O_NONBLOCK: nonblock } = flags;
  if (
    typeof nofollow !== "number" ||
    typeof nonblock !== "number" ||
    !Number.isSafeInteger(nofollow) ||
    !Number.isSafeInteger(nonblock) ||
    nofollow <= 0 ||
    nonblock <= 0 ||
    nofollow > 0x7fffffff ||
    nonblock > 0x7fffffff ||
    (nofollow & nonblock) !== 0
  )
    return "unreadable";
  let fd: number | undefined;
  let state: MarkerState = "unreadable";
  try {
    fd = open(path, constants.O_RDONLY | nofollow | nonblock);
    if (fstatSync(fd).isFile()) {
      state = readSync(fd, Buffer.alloc(1), 0, 1, 0) === 0 ? "empty" : "nonempty";
    }
  } catch (error) {
    state = (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable";
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        state = "unreadable";
      }
    }
  }
  return state;
}
