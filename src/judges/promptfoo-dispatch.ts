import { spawnSync } from "node:child_process";
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { assertQualifiedOllamaVersion } from "./ollama-version.js";
import type { buildJudgeEvaluation } from "./promptfoo-config.js";
import { isJudgeProvider } from "./promptfoo-provider.js";

const PROMPTFOO_VERSION = "0.124.1";
const MAX_REPORT_BYTES = 8 * 1024 * 1024;

function engineEntry(packageDirectory: string | undefined): string {
  try {
    if (!packageDirectory || !isAbsolute(packageDirectory)) throw new Error();
    const root = realpathSync(packageDirectory);
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (manifest.name !== "promptfoo" || manifest.version !== PROMPTFOO_VERSION) throw new Error();
    const entry = join(root, "dist", "src", "entrypoint.js");
    if (realpathSync(entry) !== entry || !lstatSync(entry).isFile()) throw new Error();
    return entry;
  } catch {
    throw new Error(
      `Set AGENTBREW_PROMPTFOO_PACKAGE to an absolute path to a trusted Promptfoo ${PROMPTFOO_VERSION} package.`,
    );
  }
}

export async function evaluateWithPromptfoo(
  config: ReturnType<typeof buildJudgeEvaluation>,
  packageDirectory = process.env.AGENTBREW_PROMPTFOO_PACKAGE,
): Promise<unknown> {
  const assertions = config.tests.flatMap((test) => test.assert);
  if (!assertions.length || assertions.some(({ provider }) => !isJudgeProvider(provider))) {
    throw new Error("Judge execution requires an Ollama chat model with the fixed response schema.");
  }

  const entry = engineEntry(packageDirectory);
  await assertQualifiedOllamaVersion();
  const scratch = mkdtempSync(join(tmpdir(), "agentbrew-judge-"));
  let failure = "Promptfoo did not produce a readable judge report.";
  try {
    const input = join(scratch, "config.json");
    const output = join(scratch, "report.json");
    writeFileSync(input, JSON.stringify(config), { mode: 0o600, flag: "wx" });
    const result = spawnSync(
      process.execPath,
      [entry, "eval", "-c", input, "--output", output, "--no-cache", "--no-share", "--no-write", "--no-progress-bar"],
      {
        cwd: scratch,
        env: {
          HOME: scratch,
          TMPDIR: scratch,
          PROMPTFOO_CONFIG_DIR: scratch,
          PROMPTFOO_DISABLE_TELEMETRY: "1",
          PROMPTFOO_DISABLE_UPDATE: "1",
          OLLAMA_BASE_URL: "http://127.0.0.1:11434",
        },
        stdio: "ignore",
        timeout: 120_000,
        killSignal: "SIGKILL",
      },
    );
    // Promptfoo uses 100 when a completed rubric assertion fails.
    if (result.error || (result.status !== 0 && result.status !== 100)) {
      const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
      failure = timedOut ? "Promptfoo timed out." : "Promptfoo could not complete the judge evaluation.";
      throw new Error();
    }
    const stat = lstatSync(output);
    if (!stat.isFile() || stat.size > MAX_REPORT_BYTES) throw new Error();
    return JSON.parse(readFileSync(output, "utf8"));
  } catch {
    throw new Error(failure);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
