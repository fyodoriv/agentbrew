import { lstatSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import chalk from "chalk";
import yaml from "js-yaml";
import { AGENTFILE_NAMES, type Agentfile, globalAgentfileDir, parseAgentfile } from "./agentfile.js";
import {
  discoverWorkspaces,
  resolveWorkspaceRoots,
  type WorkspaceRoot,
  type WorkspaceSelectionOptions,
} from "./core/workspaces.js";
import { expandHome } from "./utils.js";

interface PolicyOptions extends WorkspaceSelectionOptions {
  agentfile?: string;
}
class PolicyReadError extends Error {
  constructor(reason: string, path: string) {
    super(`Agentfile policy ${reason}; update aborted (${path}).`);
  }
}

export function resolveUpdatePolicyPath(input: string, required = false): string | undefined {
  const target = resolve(expandHome(input));
  try {
    const entry = lstatSync(target, { throwIfNoEntry: false });
    if (!entry) {
      if (required) throw new PolicyReadError("missing", target);
      return undefined;
    }
    const directory =
      entry.isDirectory() || (entry.isSymbolicLink() && statSync(target, { throwIfNoEntry: false })?.isDirectory());
    if (!directory) return target;
    for (const name of AGENTFILE_NAMES) {
      const path = join(target, name);
      if (lstatSync(path, { throwIfNoEntry: false })) return path;
    }
    if (required) throw new PolicyReadError("missing", target);
    return undefined;
  } catch (error) {
    if (error instanceof PolicyReadError) throw error;
    throw new PolicyReadError("unreadable", target);
  }
}

function strictPolicy(path: string): Agentfile {
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch {
    throw new PolicyReadError("unreadable", path);
  }
  try {
    const raw: unknown = yaml.load(content);
    if (raw !== undefined && raw !== null) {
      if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid policy structure");
      const skills = (raw as Record<string, unknown>).skills;
      if (skills !== undefined && (!Array.isArray(skills) || skills.some((skill) => typeof skill !== "string"))) {
        throw new Error("Invalid skill selection");
      }
    }
    return parseAgentfile(content);
  } catch {
    throw new PolicyReadError("invalid", path);
  }
}

function workspacePolicies(options: PolicyOptions, policies: Map<string, Agentfile>): void {
  const roots = new Map<string, WorkspaceRoot>();
  for (const base of [...policies.values(), undefined]) {
    for (const root of resolveWorkspaceRoots(options, base) ?? []) roots.set(root.root, root);
  }
  discoverWorkspaces([...roots.values()], (path) => {
    const policy = strictPolicy(path);
    policies.set(path, policy);
    return policy;
  });
}

/** Filesystem reads belong to one update invocation. Undefined means a sanitized
 * policy failure with process exit status 1; callers must stop before mutation. */
export function readUpdateSkillRequests(options: PolicyOptions = {}): string[] | undefined {
  try {
    const paths = [resolveUpdatePolicyPath(globalAgentfileDir()), resolveUpdatePolicyPath(process.cwd())];
    if (options.agentfile) paths.push(resolveUpdatePolicyPath(options.agentfile, true));
    const policies = new Map<string, Agentfile>();
    for (const path of paths) if (path) policies.set(path, strictPolicy(path));
    workspacePolicies(options, policies);
    return [...new Set([...policies.values()].flatMap((policy) => policy.skills ?? []))];
  } catch (error) {
    console.error(
      chalk.red(
        error instanceof PolicyReadError ? error.message : "Agentfile policy invalid or unreadable; update aborted.",
      ),
    );
    process.exitCode = 1;
    return undefined;
  }
}
