/** `plugin update` with a semantic diff: step 11 of #208. */
import { rmSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { home, previousHome } = vi.hoisted(() => {
  const { mkdtempSync: mk } = require("node:fs") as typeof import("node:fs");
  const { tmpdir: td } = require("node:os") as typeof import("node:os");
  const { join: j } = require("node:path") as typeof import("node:path");
  const previous = process.env.HOME;
  const dir = mk(j(td(), "plugin-update-home-"));
  process.env.HOME = dir;
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  return { home: dir, previousHome: previous };
});

import { readLock } from "../lock.js";
import { fixtureKey, type PluginFixture, pluginFixture } from "../test-utils/plugin-fixture.js";
import { addPlugin, rollbackPlugin } from "./store.js";
import { planUpdate, updatePlugin } from "./update.js";

const KEY = fixtureKey();
const MANIFEST = {
  schema: 1,
  name: "acme",
  version: "1.0.0",
  capabilities: { agents: ["claude"], hooks: ["Stop"], mcp_servers: ["acme-jira"] },
  contributes: { rules: "rules/", skills: "skills/", hooks: "hooks/hooks.json", mcp_servers: "mcp/servers.yaml" },
};
const HOOKS = (events: string[]) =>
  JSON.stringify({
    hooks: Object.fromEntries(events.map((e) => [e, [{ hooks: [{ type: "command", command: "true" }] }]])),
  });

let f: PluginFixture;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  for (const d of [".config", ".local", ".claude"]) rmSync(join(home, d), { recursive: true, force: true });
  f = pluginFixture(MANIFEST, KEY);
  f.release("v1", {
    "rules/style.md": "Use short sentences.\n",
    "skills/greet/SKILL.md": "---\nname: greet\ndescription: greet\n---\nhi",
    "hooks/hooks.json": HOOKS(["Stop"]),
    "mcp/servers.yaml": yaml.dump([{ name: "acme-jira", command: "node", args: ["a.js"] }]),
  });
  addPlugin(`${f.dir}@v1`, { yes: true, signer: KEY.pub });
});

afterAll(() => {
  process.env.HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe("planUpdate", () => {
  it("prints a semantic diff of rules, skills, MCP servers, hooks, and capabilities", () => {
    f.release("v2", {
      "rules/style.md": "Use active voice.\n",
      "rules/new.md": "New rule.\n",
      "skills/bye/SKILL.md": "---\nname: bye\ndescription: bye\n---\nbye",
      "mcp/servers.yaml": yaml.dump([{ name: "acme-jira", command: "node", args: ["b.js"] }]),
    });

    const plan = planUpdate("acme", "v2");
    try {
      expect(plan.capabilitiesChanged).toBe(false);
      expect(plan.diff).toContain("rules: + new.md");
      expect(plan.diff).toContain("rules: ~ style.md");
      expect(plan.diff).toContain("-Use short sentences.");
      expect(plan.diff).toContain("+Use active voice.");
      expect(plan.diff).toContain("skills: + bye");
      expect(plan.diff).toContain("mcp_servers: ~ acme-jira");
      expect(plan.diff).toContain("hooks: (no change)");
      expect(plan.diff).toContain("capabilities: (no change)");
    } finally {
      plan.discard();
    }
  });

  it("flags a capability change", () => {
    const manifest = { ...MANIFEST, capabilities: { ...MANIFEST.capabilities, hooks: ["Stop", "PreToolUse:Bash"] } };
    f.release("v2", {
      "agentbrew-plugin.yaml": yaml.dump(manifest),
      "hooks/hooks.json": JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "true" }] }],
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "true" }] }],
        },
      }),
    });
    const plan = planUpdate("acme", "v2");
    try {
      expect(plan.capabilitiesChanged).toBe(true);
      expect(plan.diff).toContain("hooks: + PreToolUse:Bash");
      expect(plan.diff).toMatch(/capabilities: ~ hooks/);
    } finally {
      plan.discard();
    }
  });
});

describe("updatePlugin", () => {
  it("applies nothing without confirmation", () => {
    f.release("v2", { "rules/style.md": "Changed.\n" });
    const before = readLock().plugins?.[0]?.commit;
    expect(() => updatePlugin("acme", "v2", { yes: false, capabilityApproved: false })).toThrow(/confirm/i);
    expect(readLock().plugins?.[0]?.commit).toBe(before);
  });

  it("applies with --yes, keeps the old entry as previous, and rollback returns to it", () => {
    f.release("v2", { "rules/style.md": "Changed.\n" });
    const old = readLock().plugins?.[0];
    const entry = updatePlugin("acme", "v2", { yes: true, capabilityApproved: false });
    expect(entry.ref).toBe("v2");
    expect(entry.previous?.commit).toBe(old?.commit);

    expect(rollbackPlugin("acme").commit).toBe(old?.commit);
  });

  it("a capability change needs explicit approval even with --yes", () => {
    const manifest = { ...MANIFEST, capabilities: { ...MANIFEST.capabilities, agents: ["claude", "codex"] } };
    f.release("v2", { "agentbrew-plugin.yaml": yaml.dump(manifest) });
    expect(() => updatePlugin("acme", "v2", { yes: true, capabilityApproved: false })).toThrow(/capabilit/i);
    expect(updatePlugin("acme", "v2", { yes: true, capabilityApproved: true }).ref).toBe("v2");
  });
});
