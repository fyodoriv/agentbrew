import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  computeRecordsFingerprint,
  filterSupersededTags,
  isReservedTag,
  loadMemoryPackFromDir,
  packTagsForRecord,
  parsePackManifest,
  parsePackRecordsJsonl,
  validatePackRecords,
} from "./pack-contract.js";

const fixtureDir = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures/example-pack");

describe("memory pack v1 contract", () => {
  it("loads the generic example pack fixture", () => {
    const pack = loadMemoryPackFromDir(fixtureDir);
    expect(pack.manifest.id).toBe("example-pack");
    expect(pack.records).toHaveLength(2);
    expect(pack.manifest.fingerprint).toBe(computeRecordsFingerprint(pack.records));
  });

  it("parses manifest required fields", () => {
    const manifest = parsePackManifest(`
schemaVersion: 1
id: demo
version: 0.1.0
title: Demo
description: Demo pack
privacy: private
records: records.jsonl
fingerprint: sha256:deadbeef
`);
    expect(manifest.privacy).toBe("private");
    expect(manifest.records).toBe("records.jsonl");
  });

  it("rejects duplicate record keys", () => {
    const issues = validatePackRecords(
      {
        schemaVersion: 1,
        id: "demo",
        version: "1",
        title: "t",
        description: "d",
        privacy: "public",
        records: "records.jsonl",
        fingerprint: "x",
      },
      [
        {
          key: "a",
          content: "one",
          tags: [],
          revision: 1,
          sourceFingerprint: "sha256:1",
        },
        {
          key: "a",
          content: "two",
          tags: [],
          revision: 2,
          sourceFingerprint: "sha256:2",
        },
      ],
    );
    expect(issues.some((i) => i.message.includes("duplicate"))).toBe(true);
  });

  it("builds deterministic pack tags for records", () => {
    expect(packTagsForRecord("example-pack", "1.0.0", "getting-started")).toEqual([
      "pack:id:example-pack",
      "pack:version:1.0.0",
      "pack:record:getting-started",
    ]);
  });

  it("filters superseded tags client-side", () => {
    expect(filterSupersededTags(["topic:a", "superseded:pack:demo:key", "pack:id:demo"])).toEqual([
      "topic:a",
      "pack:id:demo",
    ]);
  });

  it("flags reserved tag prefixes in user tags", () => {
    expect(isReservedTag("agentbrew:sentinel")).toBe(true);
    expect(isReservedTag("pack:id:example-pack", "example-pack")).toBe(false);
    expect(isReservedTag("superseded:pack:x:y")).toBe(true);
  });

  it("parses JSONL with stable field names", () => {
    const records = parsePackRecordsJsonl(
      `{"key":"k","content":"body","tags":["t"],"revision":2,"sourceFingerprint":"sha256:x","conversationId":"c1","confidence":0.9,"provenance":"manual"}`,
    );
    expect(records[0]).toMatchObject({
      key: "k",
      content: "body",
      revision: 2,
      conversationId: "c1",
      confidence: 0.9,
    });
  });
});
