import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  type Stats,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

interface RegistrySnapshot {
  data: Buffer;
  identity?: Stats;
}

function sameEntry(first: Stats | undefined, second: Stats | undefined): boolean {
  if (!first || !second) return first === second;
  return (
    first.dev === second.dev &&
    first.ino === second.ino &&
    first.uid === second.uid &&
    first.mode === second.mode &&
    first.nlink === second.nlink
  );
}

function changedRegistry(): Error {
  return new Error("The shared plugin signer registry changed during staging.");
}

function registrySnapshot(path: string): RegistrySnapshot {
  const identity = lstatSync(path, { throwIfNoEntry: false });
  if (!identity) return { data: Buffer.alloc(0) };
  if (!identity.isFile() || identity.uid !== process.getuid?.() || identity.nlink !== 1 || identity.mode & 0o022) {
    throw new Error("The shared plugin signer registry ownership or file type is unknown.");
  }
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!sameEntry(identity, fstatSync(fd))) throw changedRegistry();
    return { data: readFileSync(fd), identity };
  } finally {
    closeSync(fd);
  }
}

function writeStagedRegistry(path: string, body: string, mode: number): void {
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, body);
    fchmodSync(fd, mode);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** One signer writer invocation owns the staged file until rename or refusal. */
export function editLockedSignerRegistry(
  registry: string,
  assertLock: () => void,
  edit: (body: string) => string | undefined,
): void {
  const original = registrySnapshot(registry);
  const content = original.data.toString("utf8");
  if (!Buffer.from(content).equals(original.data)) {
    throw new Error("The shared plugin signer registry is not valid UTF-8.");
  }
  const next = edit(content);
  if (next === undefined) return;

  const tempDir = mkdtempSync(join(dirname(registry), ".agentbrew-signers-"));
  try {
    const staged = join(tempDir, "signers");
    const mode = original.identity ? original.identity.mode & 0o777 : 0o600;
    writeStagedRegistry(staged, next, mode);
    const current = registrySnapshot(registry);
    if (!sameEntry(original.identity, current.identity) || !original.data.equals(current.data)) {
      throw changedRegistry();
    }
    assertLock();
    renameSync(staged, registry);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
