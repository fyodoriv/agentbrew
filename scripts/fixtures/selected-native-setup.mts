import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { addPlugin, pluginDir, pluginDrift, removePlugin } from "../../src/plugins/store.js";
import { updatePlugin } from "../../src/plugins/update.js";

const [source, key, receipt] = process.argv.slice(2);
const name = "fixture-native";
const tag = "v1.0.0";
const pluginFiles: Record<string, string> = {
  "agentbrew-plugin.yaml": `schema: 1
name: fixture-native
version: 1.0.0
capabilities:
  agents: [claude]
  hooks: ["PreToolUse:Bash"]
  mcp_servers: [fixture-native-server]
  repos:
    include: ["fixture.example/**"]
contributes:
  hooks: hooks/hooks.json
  mcp_servers: mcp/servers.yaml
  rules: rules/
  leak_patterns: privacy/patterns.yaml
`,
  "hooks/hooks.json": JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/hooks/read-only.sh" }],
        },
      ],
    },
  }),
  "hooks/read-only.sh": "#!/bin/sh\nexit 0\n",
  "mcp/servers.yaml": "- name: fixture-native-server\n  command: node\n  args: [server.mjs]\n",
  "mcp/server.mjs": "process.exitCode = 0;\n",
  "rules/fixture.md": "A synthetic rule for the native sync measurement.\n",
  "privacy/patterns.yaml": "- fixture-native-synthetic-redaction\n",
};

const git = (args: string[], cwd = source) =>
  execFileSync("/usr/bin/git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 10_000,
  }).trim();

const identity = ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.com"];
for (const [path, data] of Object.entries(pluginFiles)) {
  const target = join(source, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data, { mode: path.endsWith(".sh") ? 0o755 : 0o644 });
}
git(["init", "-q"]);
git(["add", "--all"]);
git([...identity, "commit", "-qm", "Synthetic fixture"]);
git([...identity, "-c", "gpg.format=ssh", "-c", `user.signingkey=${key}`, "tag", "-s", tag, "-m", tag]);

const signer = readFileSync(`${key}.pub`, "utf8").trim();
const tagObject = git(["rev-parse", `refs/tags/${tag}`]);
const fingerprint = execFileSync("/usr/bin/ssh-keygen", ["-lf", `${key}.pub`], {
  encoding: "utf8",
  stdio: "pipe",
  timeout: 10_000,
})
  .trim()
  .split(/\s+/u)[1];
const entry = addPlugin(`${source}@${tag}`, { yes: true, signer });
if (
  entry.name !== name ||
  pluginDrift(entry) ||
  git(["rev-parse", `refs/tags/${tag}`], pluginDir(name)) !== tagObject ||
  entry.commit !== git(["rev-parse", "HEAD"]) ||
  entry.tree !== git(["rev-parse", "HEAD^{tree}"])
) {
  throw new Error("Fixture plugin identity did not qualify");
}
const files = Object.keys(pluginFiles).map((path) => {
  const installed = join(pluginDir(name), path);
  const bytes = readFileSync(installed);
  if (!bytes.equals(Buffer.from(pluginFiles[path]))) throw new Error("Fixture bytes changed during local install");
  return {
    name: path,
    mode: statSync(installed).mode & 0o777,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
});
const nextTag = "v1.1.0";
const manifestPath = join(source, "agentbrew-plugin.yaml");
writeFileSync(manifestPath, pluginFiles["agentbrew-plugin.yaml"].replace("version: 1.0.0", "version: 1.1.0"));
git(["add", "--all"]);
git([...identity, "commit", "-qm", "Synthetic next fixture"]);
git([...identity, "-c", "gpg.format=ssh", "-c", `user.signingkey=${key}`, "tag", "-s", nextTag, "-m", nextTag]);
const tags = {
  [tag]: { object: tagObject, commit: entry.commit, tree: entry.tree },
  [nextTag]: {
    object: git(["rev-parse", `refs/tags/${nextTag}`]),
    commit: git(["rev-parse", "HEAD"]),
    tree: git(["rev-parse", "HEAD^{tree}"]),
  },
};
if (process.env.NATIVE_FIXTURE_LIFECYCLE === "add") removePlugin(name);
if (process.env.NATIVE_FIXTURE_LIFECYCLE === "rollback") updatePlugin(name, nextTag, { yes: true, capabilityApproved: false });

writeFileSync(
  receipt,
  JSON.stringify({
    name,
    tag,
    tagObject,
    commit: entry.commit,
    tree: entry.tree,
    fingerprint,
    capabilitiesHash: entry.capabilitiesHash,
    files,
    tags,
  }),
  { flag: "wx", mode: 0o600 },
);
