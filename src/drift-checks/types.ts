/** Structured diff data attached to drift items for display by `status` and `--fix`. */
interface DriftDiff {
  /** Items that need to be added (server names, skill names, command file names). */
  added?: string[];
  /** Items that need to be removed. */
  removed?: string[];
  /** Items that need to be updated. */
  updated?: string[];
  /** Line count in the deployed (on-disk) version. */
  deployedLines?: number;
  /** Line count in the source (desired) version. */
  sourceLines?: number;
}

export interface DriftItem {
  agent: string;
  type:
    | "agents"
    | "cli-build"
    | "env-hygiene"
    | "organization-overlay"
    | "mcp"
    | "mcp-bare-placeholder"
    | "mcp-catalog-pin"
    | "mcp-env-vars"
    | "mcp-playwright-isolated"
    | "mcp-permissions"
    | "mcp-user-added"
    | "rules"
    | "rules-source"
    | "skills"
    | "skills-user-added"
    | "skill-validity"
    | "commands"
    | "commands-user-added"
    | "hooks"
    | "instructions"
    | "launchagent";
  detail: string;
  /** Structured diff data for display (optional — not all drift types populate this). */
  diff?: DriftDiff;
}
