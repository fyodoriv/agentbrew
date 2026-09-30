import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { AGENTBREW_TAG_PREFIX, PACK_SCHEMA_VERSION, PACK_TAG_PREFIX, SUPERSEDED_TAG_PREFIX } from "./constants.js";

export type PackPrivacy = "public" | "private";

/** pack.yaml v1 manifest. */
export interface MemoryPackManifest {
  schemaVersion: number;
  id: string;
  version: string;
  title: string;
  description: string;
  privacy: PackPrivacy;
  records: string;
  fingerprint: string;
  minAgentbrewVersion?: string;
  minMemoryServiceVersion?: string;
  validation?: string;
  eval?: string;
}

/** Deterministic JSONL record fields (v1). */
export interface MemoryPackRecord {
  key: string;
  content: string;
  tags: string[];
  conversationId?: string;
  revision: number;
  sourceFingerprint: string;
  confidence?: number;
  provenance?: string;
}

export interface ParsedMemoryPack {
  rootDir: string;
  manifest: MemoryPackManifest;
  records: MemoryPackRecord[];
}

export interface PackValidationIssue {
  path: string;
  message: string;
}

const RESERVED_PREFIXES = [PACK_TAG_PREFIX, AGENTBREW_TAG_PREFIX, SUPERSEDED_TAG_PREFIX];

/** True when tag uses a reserved prefix without being a pack-managed tag for this pack. */
export function isReservedTag(tag: string, packId?: string): boolean {
  for (const prefix of RESERVED_PREFIXES) {
    if (!tag.startsWith(prefix)) continue;
    if (prefix === PACK_TAG_PREFIX && packId) {
      if (tag === `pack:id:${packId}` || tag.startsWith(`pack:record:`) || tag.startsWith(`pack:version:`)) {
        return false;
      }
    }
    return true;
  }
  return false;
}

export function packTagsForRecord(packId: string, version: string, key: string): string[] {
  return [`pack:id:${packId}`, `pack:version:${version}`, `pack:record:${key}`];
}

function optionalManifestString(raw: Record<string, unknown>, key: string): string | undefined {
  return typeof raw[key] === "string" ? raw[key] : undefined;
}

export function parsePackManifest(content: string): MemoryPackManifest {
  const raw = yaml.load(content) as Record<string, unknown>;
  if (!raw || typeof raw !== "object") {
    throw new Error("pack.yaml must be a YAML object");
  }
  const schemaVersion = Number(raw.schemaVersion ?? raw.schema_version ?? PACK_SCHEMA_VERSION);
  const id = String(raw.id ?? "");
  const version = String(raw.version ?? "");
  const title = String(raw.title ?? "");
  const description = String(raw.description ?? "");
  const privacy = raw.privacy === "private" ? "private" : "public";
  const records = String(raw.records ?? "records.jsonl");
  const fingerprint = String(raw.fingerprint ?? "");
  if (!id || !version || !title || !fingerprint) {
    throw new Error("pack.yaml requires id, version, title, and fingerprint");
  }
  return {
    schemaVersion,
    id,
    version,
    title,
    description,
    privacy,
    records,
    fingerprint,
    minAgentbrewVersion: optionalManifestString(raw, "minAgentbrewVersion"),
    minMemoryServiceVersion: optionalManifestString(raw, "minMemoryServiceVersion"),
    validation: optionalManifestString(raw, "validation"),
    eval: optionalManifestString(raw, "eval"),
  };
}

function parseSinglePackRecord(obj: Record<string, unknown>, lineNum: number): MemoryPackRecord {
  const key = String(obj.key ?? "");
  const contentText = String(obj.content ?? "");
  const revision = Number(obj.revision ?? 1);
  const sourceFingerprint = String(obj.sourceFingerprint ?? "");
  if (!key || !contentText || !sourceFingerprint) {
    throw new Error(`records.jsonl line ${lineNum}: requires key, content, sourceFingerprint`);
  }
  const tags = Array.isArray(obj.tags) ? obj.tags.map(String) : [];
  return {
    key,
    content: contentText,
    tags,
    conversationId: typeof obj.conversationId === "string" ? obj.conversationId : undefined,
    revision: Number.isFinite(revision) ? revision : 1,
    sourceFingerprint,
    confidence: typeof obj.confidence === "number" ? obj.confidence : undefined,
    provenance: typeof obj.provenance === "string" ? obj.provenance : undefined,
  };
}

export function parsePackRecordsJsonl(content: string): MemoryPackRecord[] {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const records: MemoryPackRecord[] = [];
  for (let i = 0; i < lines.length; i++) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[i]) as unknown;
    } catch {
      throw new Error(`records.jsonl line ${i + 1}: invalid JSON`);
    }
    if (!parsed || typeof parsed !== "object") {
      throw new Error(`records.jsonl line ${i + 1}: must be an object`);
    }
    records.push(parseSinglePackRecord(parsed as Record<string, unknown>, i + 1));
  }
  return records;
}

export function validatePackRecords(manifest: MemoryPackManifest, records: MemoryPackRecord[]): PackValidationIssue[] {
  const issues: PackValidationIssue[] = [];
  const seenKeys = new Set<string>();
  for (const record of records) {
    if (seenKeys.has(record.key)) {
      issues.push({ path: record.key, message: "duplicate record key" });
    }
    seenKeys.add(record.key);
    for (const tag of record.tags) {
      if (isReservedTag(tag, manifest.id)) {
        issues.push({ path: record.key, message: `reserved tag prefix in user tags: ${tag}` });
      }
    }
  }
  return issues;
}

export function computeRecordsFingerprint(records: MemoryPackRecord[]): string {
  const canonical = records.map((r) => ({
    key: r.key,
    content: r.content,
    tags: [...r.tags].sort(),
    conversationId: r.conversationId ?? "",
    revision: r.revision,
    sourceFingerprint: r.sourceFingerprint,
    confidence: r.confidence ?? null,
    provenance: r.provenance ?? "",
  }));
  const hash = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  return `sha256:${hash}`;
}

export function loadMemoryPackFromDir(rootDir: string): ParsedMemoryPack {
  const manifestPath = join(rootDir, "pack.yaml");
  const manifest = parsePackManifest(readFileSync(manifestPath, "utf-8"));
  const recordsPath = join(rootDir, manifest.records);
  const records = parsePackRecordsJsonl(readFileSync(recordsPath, "utf-8"));
  const issues = validatePackRecords(manifest, records);
  if (issues.length > 0) {
    throw new Error(`pack validation failed: ${issues[0].message}`);
  }
  const computed = computeRecordsFingerprint(records);
  if (manifest.fingerprint !== computed) {
    throw new Error(`pack fingerprint mismatch: manifest ${manifest.fingerprint}, computed ${computed}`);
  }
  return { rootDir, manifest, records };
}

export function filterSupersededTags(tags: string[]): string[] {
  return tags.filter((tag) => !tag.startsWith(SUPERSEDED_TAG_PREFIX));
}
