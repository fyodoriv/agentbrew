import { lstatSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { DatabaseSync } from "node:sqlite";

interface ReservationOptions {
  loadSqlite?: () => Promise<{ DatabaseSync: typeof DatabaseSync }>;
  busyTimeoutMs?: number;
}

/** Hold a SQLite writer reservation in this process; this is not a launchd lock. */
export async function withMemoryWriteReservation<T>(
  dbPath: string,
  operation: (assertHeld: () => void) => Promise<T>,
  options: ReservationOptions = {},
): Promise<T> {
  if (!isAbsolute(dbPath)) throw new Error("Memory database path must be absolute");
  const original = lstatSync(dbPath);
  if (!original.isFile()) throw new Error("Memory database must be an existing regular file");
  const busyTimeoutMs = options.busyTimeoutMs ?? 5_000;
  if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0 || busyTimeoutMs > 60_000) {
    throw new Error("Invalid SQLite reservation timeout");
  }

  let sqlite: { DatabaseSync: typeof DatabaseSync };
  try {
    sqlite = await (options.loadSqlite ?? (() => import("node:sqlite")))();
  } catch {
    throw new Error("SQLite reservation is unavailable in this Node runtime");
  }

  const db = new sqlite.DatabaseSync(dbPath);
  let held = false;
  try {
    db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}; BEGIN IMMEDIATE;`);
    held = true;
    const assertHeld = () => {
      const current = lstatSync(dbPath);
      if (!current.isFile() || current.dev !== original.dev || current.ino !== original.ino) {
        throw new Error("Memory database changed during reservation");
      }
    };
    assertHeld();
    const result = await operation(assertHeld);
    assertHeld();
    return result;
  } finally {
    try {
      if (held) db.exec("ROLLBACK;");
    } finally {
      db.close();
    }
  }
}
