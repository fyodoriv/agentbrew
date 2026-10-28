import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentBrewState } from "../types.js";
import { linkedWorktreeToSkip, linkedWorktreeWarning } from "./linked-worktree.js";

const dirs: string[] = [];
function repo(): { main: string; wt: string } {
  const base = mkdtempSync(join(tmpdir(), "linked-wt-"));
  dirs.push(base);
  const main = join(base, "tool");
  const wt = join(base, "wt", "feature");
  mkdirSync(join(main, ".git", "worktrees", "feature"), { recursive: true });
  mkdirSync(wt, { recursive: true });
  writeFileSync(join(wt, ".git"), `gitdir: ${join(main, ".git", "worktrees", "feature")}\n`);
  return { main, wt };
}
const state = (paths: string[]): AgentBrewState =>
  ({
    agents: [],
    catalogVersion: "test",
    commandSourceDirs: paths.map((p) => ({ label: "tool", path: p, origin: "agentfile", agentfile: p })),
  }) as AgentBrewState;

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("linkedWorktreeToSkip (sync-skip-linked-worktree-agentfile)", () => {
  it("names the main checkout when the cwd is a linked worktree of a registered source", () => {
    const { main, wt } = repo();
    expect(linkedWorktreeToSkip(wt, state([join(main, "commands")]))).toBe(main);
  });

  it("does not skip a linked worktree whose main checkout is not registered", () => {
    const { wt } = repo();
    expect(linkedWorktreeToSkip(wt, state(["/elsewhere/commands"]))).toBeUndefined();
  });

  it("does not skip a main checkout or a plain folder", () => {
    const { main } = repo();
    expect(linkedWorktreeToSkip(main, state([join(main, "commands")]))).toBeUndefined();
    expect(linkedWorktreeToSkip(tmpdir(), state([join(main, "commands")]))).toBeUndefined();
  });

  it("prints one warning line with the main checkout under ~", () => {
    expect(linkedWorktreeWarning("/h/me/apps/tool", "/h/me")).toBe(
      "⚠ Skipped this worktree's Agentfile: it is a linked worktree of ~/apps/tool. Sync from there.",
    );
  });
});
