import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

type MarkerState = "missing" | "empty" | "nonempty" | "unreadable";

export function observeMarker(path: string): MarkerState {
  let fd: number | undefined;
  let state: MarkerState = "unreadable";
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
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
