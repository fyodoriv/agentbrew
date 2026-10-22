import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import yaml from "js-yaml";
import schema from "./agentbrew-plugin.schema.json";

/** File name of the plugin manifest at the plugin repo root. */
export const MANIFEST_FILE = "agentbrew-plugin.yaml";

export interface PluginCapabilities {
  agents?: string[];
  repos?: { include?: string[]; exclude?: string[] };
  hooks?: string[];
  mcp_servers?: string[];
  network_hosts?: string[];
  commands_exec?: boolean;
  secrets?: string[];
}

export interface PluginManifest {
  schema: 1;
  name: string;
  version: string;
  requires_core?: string;
  capabilities?: PluginCapabilities;
  contributes?: Record<string, unknown>;
}

export type ManifestResult = { ok: true; manifest: PluginManifest } | { ok: false; errors: string[] };

const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

/** Check a parsed manifest against `agentbrew-plugin.schema.json`. */
export function validateManifest(value: unknown): ManifestResult {
  if (validate(value)) return { ok: true, manifest: value as unknown as PluginManifest };
  const errors = (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`);
  return { ok: false, errors };
}

/** Read and validate the manifest in a plugin checkout. Throws with every schema error. */
export function readManifest(dir: string): PluginManifest {
  let text: string;
  try {
    text = readFileSync(join(dir, MANIFEST_FILE), "utf-8");
  } catch (e) {
    throw new Error(`Cannot read plugin manifest ${MANIFEST_FILE}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return parseManifest(text);
}

/** Parse and validate manifest text. Throws with every schema error. */
export function parseManifest(text: string): PluginManifest {
  let parsed: unknown;
  try {
    parsed = yaml.load(text);
  } catch (e) {
    throw new Error(`Cannot read plugin manifest ${MANIFEST_FILE}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const result = validateManifest(parsed);
  if (!result.ok) throw new Error(`Invalid plugin manifest ${MANIFEST_FILE}:\n  ${result.errors.join("\n  ")}`);
  return result.manifest;
}

/** Stable SHA-256 of the declared capabilities (key order does not matter). */
export function capabilitiesHash(capabilities: PluginCapabilities | undefined): string {
  return createHash("sha256")
    .update(stableJson(capabilities ?? {}))
    .digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}
