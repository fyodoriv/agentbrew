import { isAbsolute } from "node:path";
import { resolveTaskBackend } from "./core/task-backend.js";

const repo = process.argv[2];
if (!repo || !isAbsolute(repo)) {
  process.exitCode = 2;
} else {
  try {
    process.stdout.write(resolveTaskBackend(repo).backend);
  } catch {
    process.exitCode = 2;
  }
}
