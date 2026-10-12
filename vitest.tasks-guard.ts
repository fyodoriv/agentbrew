import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll } from "vitest";

// Fails a test file that writes to the repo's own TASKS.md.
// Code under test may file tasks there (for example MCP follow-up tasks),
// so a test that forgets to stub the writer leaks fixture tasks into the queue.
const tasksPath = resolve(import.meta.dirname, "TASKS.md");

function digest(): string | undefined {
  return existsSync(tasksPath) ? createHash("sha256").update(readFileSync(tasksPath)).digest("hex") : undefined;
}

let before: string | undefined;

beforeAll(() => {
  before = digest();
});

afterAll(() => {
  if (digest() !== before) {
    throw new Error(`This test file changed ${tasksPath}. Stub the writer (for example writeFollowups).`);
  }
});
