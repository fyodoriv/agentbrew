import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { memoryPackLedgerPath, memoryPacksLedgerDir } from "./paths.js";

export interface PackLedgerRecordState {
  memoryId: string;
  revision: number;
  sourceFingerprint: string;
  contentFingerprint: string;
}

export interface PackInstallLedger {
  packId: string;
  version: string;
  fingerprint: string;
  packPath: string;
  installedAt: string;
  records: Record<string, PackLedgerRecordState>;
}

export function readPackLedger(packId: string): PackInstallLedger | undefined {
  const path = memoryPackLedgerPath(packId);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as PackInstallLedger;
  } catch {
    return undefined;
  }
}

export function writePackLedger(ledger: PackInstallLedger): void {
  mkdirSync(memoryPacksLedgerDir(), { recursive: true });
  writeFileSync(memoryPackLedgerPath(ledger.packId), `${JSON.stringify(ledger, null, 2)}\n`, "utf-8");
}

export function deletePackLedger(packId: string): boolean {
  const path = memoryPackLedgerPath(packId);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

export function listInstalledPackLedgers(): PackInstallLedger[] {
  const dir = memoryPacksLedgerDir();
  if (!existsSync(dir)) return [];
  const ledgers: PackInstallLedger[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const packId = file.replace(/\.json$/, "");
    const ledger = readPackLedger(packId);
    if (ledger) ledgers.push(ledger);
  }
  return ledgers;
}
