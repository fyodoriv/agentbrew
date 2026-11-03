import { spawnSync } from "node:child_process";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { builtCliRoot } from "./cli-build-health.js";

function isArm64Executable(asset: string): boolean {
  try {
    const fd = openSync(asset, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = fstatSync(fd);
      const header = Buffer.alloc(32);
      // The build stages a thin, little-endian Mach-O executable.
      return (
        stat.isFile() &&
        readSync(fd, header, 0, header.length, 0) === header.length &&
        header.readUInt32LE(0) === 0xfeedfacf &&
        header.readUInt32LE(4) === 0x0100000c &&
        header.readUInt32LE(12) === 2 &&
        header.readUInt32LE(16) > 0 &&
        header.length + header.readUInt32LE(20) < stat.size
      );
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

function invoke(args: string[], json: boolean): void {
  const root = builtCliRoot();
  const asset = root && join(root, "dist", "native", "darwin-arm64", "checkup-run");
  const result =
    asset && process.platform === "darwin" && process.arch === "arm64" && isArm64Executable(asset)
      ? spawnSync(asset, args, {
          encoding: "utf8",
          timeout: 5000,
          maxBuffer: 128 * 1024,
        })
      : null;
  if (!result || result.error || (result.status !== 0 && result.status !== 2)) {
    console.error(json ? '{"status":"error","code":"unsupported-target"}' : "Checkup records unavailable.");
    process.exitCode = 2;
    return;
  }
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.status;
}

export function registerCheckupRunCommand(program: Command): void {
  const command = program.command("checkup-run").description("Read and record completed checkups");
  command
    .command("show")
    .argument("<checkup>")
    .option("--json", "Output as JSON")
    .action((checkup: string, options: { json?: boolean }) => {
      invoke(["show", checkup, ...(options.json ? ["--json"] : [])], Boolean(options.json));
    });
  command
    .command("record")
    .argument("<checkup>")
    .requiredOption("--finished-at <time>", "Assessment completion time")
    .requiredOption("--result <result>", "green, degraded, or blocked")
    .option("--commit <entry...>", "Checked repository and commit")
    .option("--json", "Output as JSON")
    .action((checkup: string, options: { finishedAt: string; result: string; commit?: string[]; json?: boolean }) => {
      const args = ["record", checkup, "--finished-at", options.finishedAt, "--result", options.result];
      for (const entry of options.commit ?? []) args.push("--commit", entry);
      if (options.json) args.push("--json");
      invoke(args, Boolean(options.json));
    });
}
