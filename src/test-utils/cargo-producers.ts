import { lstatSync, opendirSync, readFileSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";

function validateRoot(root: string, release: string, uid: number | undefined) {
  const rootStat = lstatSync(root);
  const rel = relative(root, release);
  if (
    !rootStat.isDirectory() ||
    (rootStat.mode & 0o077) !== 0 ||
    (uid !== undefined && rootStat.uid !== uid) ||
    rel.startsWith("../") ||
    rel === ".." ||
    realpathSync(release) !== release
  ) {
    throw new Error("unsafe fixture root");
  }
}

function validateLinks(
  match: string,
  final: string | undefined,
  release: string,
  original: Buffer,
  uid: number | undefined,
) {
  const producerStat = lstatSync(match);
  if (final) {
    const finalStat = lstatSync(final);
    if (
      final !== join(release, "checkup-run") ||
      realpathSync(final) !== final ||
      !finalStat.isFile() ||
      (uid !== undefined && finalStat.uid !== uid) ||
      finalStat.size !== original.length ||
      !readFileSync(final).equals(original)
    )
      throw new Error("unsafe final file");
    const same = finalStat.dev === producerStat.dev && finalStat.ino === producerStat.ino;
    if ((finalStat.nlink !== 1 || producerStat.nlink !== 1) && !(same && finalStat.nlink === 2)) {
      throw new Error("unsafe producer links");
    }
  } else if (producerStat.nlink !== 1) throw new Error("unsafe producer links");
}

// Call only after Cargo exits in a fresh, private fixture with no concurrent writers.
export function cargoProducer(release: string, original: Buffer, root: string, final?: string): string {
  const limit = 128;
  if (original.length > 64 * 1024 * 1024) throw new Error("producer too large");
  let scanned = 0;
  const uid = process.getuid?.();
  validateRoot(root, release, uid);
  const entries = (dir: string): string[] => {
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    if (!stat.isDirectory() || (uid !== undefined && stat.uid !== uid)) throw new Error("unsafe producer directory");
    const names: string[] = [];
    const handle = opendirSync(dir);
    try {
      for (let entry = handle.readSync(); entry; entry = handle.readSync()) {
        if (++scanned > limit) throw new Error("too many producer entries");
        names.push(entry.name);
      }
    } finally {
      handle.closeSync();
    }
    return names;
  };
  const matches: string[] = [];
  entries(release);
  const inspect = (dir: string, names: string[]) => {
    for (const name of names) {
      if (!/^checkup[-_]run(?:-[a-f0-9]+)?$/.test(name)) continue;
      const file = join(dir, name);
      const stat = lstatSync(file);
      if (!stat.isFile() || (uid !== undefined && stat.uid !== uid)) throw new Error("unsafe producer file");
      if (stat.size === original.length && readFileSync(file).equals(original)) matches.push(file);
    }
  };
  const deps = join(release, "deps");
  inspect(deps, entries(deps));
  const build = join(release, "build");
  if (entries(build).includes("checkup-run")) {
    const pkg = join(build, "checkup-run");
    for (const unit of entries(pkg)) {
      if (!/^[a-f0-9]+$/.test(unit)) continue;
      const unitDir = join(pkg, unit);
      if (!entries(unitDir).includes("out")) continue;
      const out = join(unitDir, "out");
      inspect(out, entries(out));
    }
  }
  const [match] = matches;
  if (matches.length !== 1 || !match) throw new Error("expected exactly one matching producer");
  validateLinks(match, final, release, original, uid);
  return match;
}
