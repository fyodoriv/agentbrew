import { spawnSync } from "node:child_process";
import { MAX_JUDGE_INPUT_BYTES, readCreateBody } from "./artifact.js";
import type { parseJudgePrArguments } from "./pr-arguments.js";

export function readJudgePrBody(target: ReturnType<typeof parseJudgePrArguments>, cwd: string): Buffer {
  if (target.event === "pr-create") return readCreateBody(target, cwd);

  try {
    const args = ["pr", "view", target.number, "--json", "number,body"];
    if (target.repo) args.push("--repo", target.repo);
    const response = spawnSync("gh", args, {
      cwd,
      shell: false,
      timeout: 5000,
      maxBuffer: MAX_JUDGE_INPUT_BYTES * 6 + 4096,
      encoding: "utf8",
      env: { ...process.env, GH_PROMPT_DISABLED: "1" },
    });
    if (response.error || response.status !== 0) throw new Error();
    const { number, body } = JSON.parse(response.stdout) as { number?: unknown; body?: unknown };
    if (!Number.isSafeInteger(number) || String(number) !== target.number || typeof body !== "string") {
      throw new Error();
    }
    const bytes = Buffer.from(body, "utf8");
    if (bytes.length > MAX_JUDGE_INPUT_BYTES) throw new Error();
    return bytes;
  } catch {
    throw new Error("Judge could not verify the current PR body.");
  }
}
