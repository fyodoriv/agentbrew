import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockWriteFileAtomic, mockLogSkipped } = vi.hoisted(() => ({
  mockWriteFileAtomic: vi.fn((path: string, content: string) => {
    const { writeFileSync: realWrite } = require("node:fs");
    const { mkdirSync: realMkdir, existsSync: realExists } = require("node:fs");
    const { dirname } = require("node:path");
    if (!realExists(dirname(path))) realMkdir(dirname(path), { recursive: true });
    realWrite(path, content);
  }),
  mockLogSkipped: vi.fn(),
}));

vi.mock("write-file-atomic", () => ({
  sync: mockWriteFileAtomic,
}));

vi.mock("./core/logger.js", () => ({
  logSkipped: mockLogSkipped,
}));

import type { Manifest } from "./manifest.js";
import { contentHash, removeFromManifest, saveManifest, writeIfChanged } from "./manifest.js";

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "manifest-test-"));
});

describe("contentHash", () => {
  it("returns consistent SHA-256 hex for same input", () => {
    const hash1 = contentHash("hello world");
    const hash2 = contentHash("hello world");
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it("returns different hashes for different input", () => {
    expect(contentHash("a")).not.toBe(contentHash("b"));
  });
});

describe("writeIfChanged", () => {
  it("writes file when it does not exist", () => {
    const path = join(testDir, "new-file.txt");
    const manifest: Manifest = { hashes: {} };

    const written = writeIfChanged(path, "hello", manifest);

    expect(written).toBe(true);
    expect(readFileSync(path, "utf-8")).toBe("hello");
    expect(manifest.hashes[path]).toBe(contentHash("hello"));
  });

  it("skips write when content matches existing file", () => {
    const path = join(testDir, "existing.txt");
    const { writeFileSync: realWrite } = require("node:fs");
    realWrite(path, "same content");
    const manifest: Manifest = { hashes: {} };

    const written = writeIfChanged(path, "same content", manifest);

    expect(written).toBe(false);
    expect(manifest.hashes[path]).toBe(contentHash("same content"));
  });

  it("writes when content differs from existing file", () => {
    const path = join(testDir, "changed.txt");
    const { writeFileSync: realWrite } = require("node:fs");
    realWrite(path, "old content");
    const manifest: Manifest = { hashes: {} };

    const written = writeIfChanged(path, "new content", manifest);

    expect(written).toBe(true);
    expect(readFileSync(path, "utf-8")).toBe("new content");
    expect(manifest.hashes[path]).toBe(contentHash("new content"));
  });

  it("skips write when file content matches even with manifest hash", () => {
    const path = join(testDir, "cached.txt");
    const { writeFileSync: realWrite } = require("node:fs");
    realWrite(path, "cached");
    const hash = contentHash("cached");
    const manifest: Manifest = { hashes: { [path]: hash } };

    const written = writeIfChanged(path, "cached", manifest);

    expect(written).toBe(false);
  });

  it("detects externally modified file despite matching manifest hash", () => {
    const path = join(testDir, "tampered.txt");
    const { writeFileSync: realWrite } = require("node:fs");
    const desiredContent = "correct content";
    const manifest: Manifest = { hashes: { [path]: contentHash(desiredContent) } };
    // File was externally modified after the manifest was saved
    realWrite(path, "externally modified content");

    const written = writeIfChanged(path, desiredContent, manifest);

    expect(written).toBe(true);
    expect(readFileSync(path, "utf-8")).toBe(desiredContent);
  });

  it("falls back to disk read when manifest hash is stale", () => {
    const path = join(testDir, "stale.txt");
    const { writeFileSync: realWrite } = require("node:fs");
    realWrite(path, "new content");
    const manifest: Manifest = { hashes: { [path]: contentHash("old content") } };

    const written = writeIfChanged(path, "new content", manifest);

    expect(written).toBe(false);
    expect(manifest.hashes[path]).toBe(contentHash("new content"));
  });

  it("writes when manifest says cached but file was deleted", () => {
    const path = join(testDir, "deleted.txt");
    const hash = contentHash("content");
    const manifest: Manifest = { hashes: { [path]: hash } };

    const written = writeIfChanged(path, "content", manifest);

    expect(written).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  it("creates parent directories", () => {
    const path = join(testDir, "deep", "nested", "file.txt");
    const manifest: Manifest = { hashes: {} };

    writeIfChanged(path, "deep write", manifest);

    expect(readFileSync(path, "utf-8")).toBe("deep write");
  });

  it("works without manifest argument", () => {
    const path = join(testDir, "no-manifest.txt");

    const written = writeIfChanged(path, "content");

    expect(written).toBe(true);
    expect(readFileSync(path, "utf-8")).toBe("content");
  });
});

describe("removeFromManifest", () => {
  it("deletes the path entry", () => {
    const manifest: Manifest = { hashes: { "/a": "hash1", "/b": "hash2" } };
    removeFromManifest("/a", manifest);
    expect(manifest.hashes).toEqual({ "/b": "hash2" });
  });

  it("is a no-op for missing paths", () => {
    const manifest: Manifest = { hashes: { "/a": "hash1" } };
    removeFromManifest("/missing", manifest);
    expect(manifest.hashes).toEqual({ "/a": "hash1" });
  });
});

describe("saveManifest", () => {
  it("does not throw when write fails", () => {
    mockWriteFileAtomic.mockImplementationOnce(() => {
      throw new Error("ENOSPC: no space left on device");
    });
    const manifest: Manifest = { hashes: { "/a": "hash1" } };

    expect(() => saveManifest(manifest)).not.toThrow();
    expect(mockLogSkipped).toHaveBeenCalledWith("manifest/save", expect.any(Error));
  });
});

describe("writeIfChanged error paths", () => {
  it("falls through to write when read of existing file throws", () => {
    const path = join(testDir, "unreadable.txt");
    const { writeFileSync: realWrite, chmodSync } = require("node:fs");
    realWrite(path, "old content");
    chmodSync(path, 0o200); // write-only — readFileSync throws EACCES

    const manifest: Manifest = { hashes: {} };
    const written = writeIfChanged(path, "new content", manifest);

    chmodSync(path, 0o644);

    expect(written).toBe(true);
    expect(mockLogSkipped).toHaveBeenCalledWith("manifest/readExisting", expect.any(Error));
  });
});
