import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

const location = vi.hoisted(() => ({ home: "" }));
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => location.home,
}));
vi.mock("./contributions.js", () => ({ activePlugins: () => [] }));
vi.mock("./native-publication-lock.js", () => ({
  withNativePublicationLock: vi.fn(() => {
    throw new Error("Synthetic prototype owner is unavailable.");
  }),
}));

import { emitClaudeNative, marketplaceDir } from "./claude-native.js";
import { withNativePublicationLock } from "./native-publication-lock.js";

it("keeps ordinary native publication available without the prototype owner", () => {
  location.home = mkdtempSync(join(tmpdir(), "ordinary-native-home-"));
  try {
    expect(() => emitClaudeNative()).not.toThrow();
    expect(withNativePublicationLock).not.toHaveBeenCalled();
    expect(existsSync(marketplaceDir())).toBe(false);
    expect(existsSync(join(location.home, ".claude", "settings.json"))).toBe(false);
  } finally {
    rmSync(location.home, { recursive: true, force: true });
  }
});
