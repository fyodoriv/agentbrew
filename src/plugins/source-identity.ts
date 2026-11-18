import type { PluginLockEntry } from "../lock.js";

/** The signed source fields that identify what a plugin can publish. */
export function pluginSourceIdentity(entry: PluginLockEntry) {
  const { name, version, source, ref, commit, tree, capabilitiesHash, signer } = entry;
  return { name, version, source, ref, commit, tree, capabilitiesHash, signer };
}
