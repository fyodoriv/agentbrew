import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { withNativePublicationLock } from "./native-publication-lock.js";

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, readFileSync: vi.fn(fs.readFileSync) };
});

vi.mock("node:os", async (original) => {
  const os = await original<typeof import("node:os")>();
  return { ...os, homedir: vi.fn(os.homedir) };
});

function inScratchHome(check: (owner: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), "native-owner-"));
  const owner = join(realpathSync.native(home), ".agentbrew-native-publication.lock");
  try {
    vi.mocked(homedir).withImplementation(
      () => home,
      () => check(owner),
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

it.skipIf(process.platform === "win32")("checks the held owner without reopening its pathname", () => {
  inScratchHome((owner) => {
    const reads = vi.mocked(readFileSync);
    reads.mockClear();
    const result = withNativePublicationLock((beginMutation) => {
      beginMutation();
      return "published";
    });
    expect(result).toBe("published");
    expect(existsSync(owner)).toBe(false);
    const pathnameReads = reads.mock.calls.filter(([path]) => path === owner).length;
    expect(pathnameReads).toBe(0);
  });
});

it.skipIf(process.platform === "win32")("preserves the owner when its same-length bytes change", () => {
  inScratchHome((owner) => {
    let length = 0;
    expect(() => {
      withNativePublicationLock((beginMutation) => {
        length = readFileSync(owner).length;
        writeFileSync(owner, Buffer.alloc(length, 0x78));
        beginMutation();
      });
    }).toThrow(/native publication ownership changed/u);
    expect(length).toBeGreaterThan(0);
    expect(readFileSync(owner).equals(Buffer.alloc(length, 0x78))).toBe(true);
  });
});
