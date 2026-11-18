import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { sync as atomicWrite } from "write-file-atomic";
import { trustSigner } from "./signers.js";

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, writeFileSync: vi.fn(fs.writeFileSync) };
});
vi.mock("write-file-atomic", async (original) => {
  const atomic = await original<typeof import("write-file-atomic")>();
  return { ...atomic, sync: vi.fn(atomic.sync) };
});

it.skipIf(process.platform !== "linux" && process.platform !== "darwin")(
  "refuses a new observation of the registry during staging",
  async () => {
    const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
    const atomic = await vi.importActual<typeof import("write-file-atomic")>("write-file-atomic");
    const home = mkdtempSync(join(tmpdir(), "agentbrew-signer-observation-"));
    const registry = join(home, "allowed_signers");
    const original = "# Synthetic first state.\n";
    const next = "# Synthetic newer state.\n";
    writeFileSync(registry, original, { mode: 0o600 });
    vi.stubEnv("AGENT_PLUGINS_ALLOWED_SIGNERS", registry);
    vi.mocked(writeFileSync).mockImplementationOnce((path, data, options) => {
      fs.writeFileSync(path, data, options);
      fs.writeFileSync(registry, next);
    });
    vi.mocked(atomicWrite).mockImplementationOnce((path, data, options) => {
      fs.writeFileSync(registry, next);
      atomic.sync(path, data, options);
    });
    try {
      expect(() => trustSigner("fixture", "ssh-ed25519 U3ludGhldGlj")).toThrow(/registry changed during staging/u);
      expect(readFileSync(registry, "utf8")).toBe(next);
    } finally {
      vi.mocked(writeFileSync).mockReset();
      vi.mocked(atomicWrite).mockReset();
      vi.unstubAllEnvs();
      rmSync(home, { recursive: true, force: true });
    }
  },
);
