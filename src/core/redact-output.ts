import { redactUrlCredentials } from "./redact-url.js";

/**
 * Output redaction for the CLI process: every write to stdout and stderr goes
 * through {@link redactUrlCredentials}, so a token inside a git URL never
 * reaches the terminal or a log, whichever code path prints it.
 *
 * Owner and lifecycle: this module owns the wrapped `process.stdout.write` and
 * `process.stderr.write`. `src/cli.ts` installs it once, at the CLI
 * entrypoint, for the whole process; it is never removed. Tests that import
 * modules do not install it, and use {@link redactStreamWrites} on a fake
 * stream instead.
 */

type Write = (chunk: unknown, ...rest: unknown[]) => boolean;

/** Wrap `stream.write` so string and byte chunks are redacted before they are written. */
export function redactStreamWrites(stream: { write: Write }): void {
  const write = stream.write.bind(stream) as Write;
  stream.write = ((chunk: unknown, ...rest: unknown[]) => {
    if (typeof chunk === "string") return write(redactUrlCredentials(chunk), ...rest);
    if (chunk instanceof Uint8Array) {
      const text = Buffer.from(chunk).toString("utf-8");
      const redacted = redactUrlCredentials(text);
      return write(redacted === text ? chunk : Buffer.from(redacted, "utf-8"), ...rest);
    }
    return write(chunk, ...rest);
  }) as Write;
}

/** Redact every write to this process's stdout and stderr. Call once, at the CLI entrypoint. */
export function installOutputRedaction(): void {
  redactStreamWrites(process.stdout as unknown as { write: Write });
  redactStreamWrites(process.stderr as unknown as { write: Write });
}
