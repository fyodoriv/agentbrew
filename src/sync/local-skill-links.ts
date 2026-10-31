import { lstatSync, readlinkSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Manifest } from "../manifest.js";

interface LinkPlan {
  desired: ReadonlyMap<string, string>;
  declared: ReadonlySet<string>;
  dryRun: boolean;
  prune: boolean;
  activeDirectories: ReadonlySet<string>;
}

/** Only receipt reconciliation retires declared links. Generic sweeps keep every
 * retained receipt, including excluded hosts and deferred no-prune removals. */
export function protectedLocalSkillPaths(manifest: Manifest): Set<string> {
  const paths = new Set(
    (manifest.localSkillConflicts ?? []).filter((dest) => lstatSync(dest, { throwIfNoEntry: false })),
  );
  for (const dest of Object.keys(manifest.localSkillLinks ?? {})) paths.add(dest);
  return paths;
}

function reconcileReceipt(dest: string, source: string, plan: LinkPlan): "keep" | "remove" | "owner" | "defer" {
  if (!plan.activeDirectories.has(dirname(dest))) return "keep";
  const entry = lstatSync(dest, { throwIfNoEntry: false });
  if (!entry) return "remove";
  if (!entry.isSymbolicLink() || resolve(dirname(dest), readlinkSync(dest)) !== source) return "owner";
  if (plan.desired.get(dest) === source) return plan.declared.has(dest) ? "keep" : "remove";
  if (!plan.prune && !plan.desired.has(dest)) return "defer";
  if (!plan.dryRun) unlinkSync(dest);
  return "remove";
}

function protectExistingDestinations(
  manifest: Manifest,
  declared: ReadonlySet<string>,
  conflicts: Set<string>,
  protectedPaths: Set<string>,
): void {
  for (const dest of declared) {
    if (!manifest.localSkillLinks?.[dest] && lstatSync(dest, { throwIfNoEntry: false })) {
      conflicts.add(dest);
      protectedPaths.add(dest);
    }
  }
}

function saveLinkReceipts(manifest: Manifest, receipts: Record<string, string>, conflicts: Set<string>): void {
  if (manifest.localSkillLinks || Object.keys(receipts).length > 0) manifest.localSkillLinks = receipts;
  if (manifest.localSkillConflicts || conflicts.size > 0) manifest.localSkillConflicts = [...conflicts];
}

/** Manifest-scoped receipts track exact deployed leaves, never whole host directories.
 * Conflicts protect changed or pre-existing owner destinations, including after
 * declaration removal. A conflict ends only when its destination is absent. */
export function reconcileLocalSkillLinks(
  manifest: Manifest,
  desired: ReadonlyMap<string, string>,
  declared: ReadonlySet<string>,
  options: { dryRun: boolean; prune: boolean; activeDirectories: ReadonlySet<string> },
): Set<string> {
  const receipts = { ...manifest.localSkillLinks };
  const conflicts = new Set(
    (manifest.localSkillConflicts ?? []).filter((dest) => lstatSync(dest, { throwIfNoEntry: false })),
  );
  const protectedPaths = new Set(conflicts);
  for (const [dest, source] of Object.entries(receipts)) {
    const result = reconcileReceipt(dest, source, { desired, declared, ...options });
    if (result === "owner") conflicts.add(dest);
    if (result === "owner" || result === "defer") protectedPaths.add(dest);
    if (result !== "keep" && result !== "defer") delete receipts[dest];
  }
  // Opting into a source never adopts an existing owner's destination.
  protectExistingDestinations(manifest, declared, conflicts, protectedPaths);
  if (!options.dryRun) saveLinkReceipts(manifest, receipts, conflicts);
  return protectedPaths;
}
