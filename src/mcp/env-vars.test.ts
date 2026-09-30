import { describe, expect, it } from "vitest";
import {
  applyResilientToValue,
  BARE_PLACEHOLDER_PATTERN,
  containsPlaceholder,
  convertEnvVars,
  convertServerEnvVars,
  findBarePlaceholdersIn,
  fromCanonical,
  getEnvFormat,
  getInheritedServerEnvKeys,
  hasUnresolvedLiterals,
  makeResilient,
  mergeEnvPreservingResolved,
  resolveEnvVar,
  toCanonical,
} from "./env-vars.js";

describe("toCanonical", () => {
  it("passes through standard ${VAR} format", () => {
    expect(toCanonical("${MY_KEY}")).toBe("${MY_KEY}");
  });

  it("converts opencode ${env:VAR} to canonical", () => {
    expect(toCanonical("${env:MY_KEY}")).toBe("${MY_KEY}");
  });

  it("converts codex {env:VAR} to canonical", () => {
    expect(toCanonical("{env:MY_KEY}")).toBe("${MY_KEY}");
  });

  it("handles mixed formats in one string", () => {
    expect(toCanonical("prefix-${env:A}-{env:B}-suffix")).toBe("prefix-${A}-${B}-suffix");
  });

  it("handles plain text without env vars", () => {
    expect(toCanonical("no-vars-here")).toBe("no-vars-here");
  });

  it("passes through ${VAR:-default} as canonical (already canonical)", () => {
    expect(toCanonical("${MY_KEY:-fallback}")).toBe("${MY_KEY:-fallback}");
  });

  it("passes through ${VAR:-} as canonical (already canonical)", () => {
    expect(toCanonical("${MY_KEY:-}")).toBe("${MY_KEY:-}");
  });
});

describe("fromCanonical", () => {
  it("standard format rewrites bare ${VAR} to resilient ${VAR:-} form", () => {
    // Why not identity anymore: strict env-var interpolators (Devin CLI binary importing
    // ~/.claude.json and ~/.cursor/mcp.json) abort the whole MCP load on bare ${VAR} when
    // the env var is unset. Emitting ${VAR:-} keeps the value bash-compatible while
    // preventing the import-time crash. See `makeResilient` docstring in env-vars.ts.
    expect(fromCanonical("${MY_KEY}", "standard")).toBe("${MY_KEY:-}");
  });

  it("converts to opencode format", () => {
    expect(fromCanonical("${MY_KEY}", "opencode")).toBe("${env:MY_KEY}");
  });

  it("converts to codex format", () => {
    expect(fromCanonical("${MY_KEY}", "codex")).toBe("{env:MY_KEY}");
  });

  it("handles multiple vars in one string", () => {
    expect(fromCanonical("${A}:${B}", "codex")).toBe("{env:A}:{env:B}");
  });

  it("literal format resolves from process.env", () => {
    process.env.TEST_LITERAL_VAR = "my-secret";
    expect(fromCanonical("${TEST_LITERAL_VAR}", "literal")).toBe("my-secret");
    delete process.env.TEST_LITERAL_VAR;
  });

  it("literal format falls back to resilient placeholder when var is unset", () => {
    // Why ${VAR:-} not bare ${VAR}: Devin reads its OWN mcpServers block back through the
    // same interpolator that handles imported Claude/Cursor configs. A bare placeholder
    // here would crash Devin's loader on a subsequent launch. The resilient form lets the
    // user set the env var later (a `agentbrew setup` step) and pick up the value via
    // bash-style substitution at MCP server launch time.
    delete process.env.UNSET_VAR_XYZ;
    expect(fromCanonical("${UNSET_VAR_XYZ}", "literal")).toBe("${UNSET_VAR_XYZ:-}");
  });

  it("literal format resolves ${VAR:-default} to env value when set", () => {
    process.env.TEST_DEFAULT_VAR = "real-value";
    expect(fromCanonical("${TEST_DEFAULT_VAR:-fallback}", "literal")).toBe("real-value");
    delete process.env.TEST_DEFAULT_VAR;
  });

  it("literal format resolves ${VAR:-default} to default when var is unset", () => {
    delete process.env.MISSING_DEFAULT_VAR;
    expect(fromCanonical("${MISSING_DEFAULT_VAR:-fallback}", "literal")).toBe("fallback");
  });

  it("literal format resolves ${VAR:-} to empty string when var is unset", () => {
    delete process.env.MISSING_EMPTY_DEFAULT;
    expect(fromCanonical("${MISSING_EMPTY_DEFAULT:-}", "literal")).toBe("");
  });

  it("standard format preserves ${VAR:-default} as-is", () => {
    expect(fromCanonical("${MY_KEY:-fallback}", "standard")).toBe("${MY_KEY:-fallback}");
  });

  it("opencode format converts ${VAR:-default} stripping default", () => {
    expect(fromCanonical("${MY_KEY:-fallback}", "opencode")).toBe("${env:MY_KEY}");
  });

  it("codex format converts ${VAR:-default} stripping default", () => {
    expect(fromCanonical("${MY_KEY:-fallback}", "codex")).toBe("{env:MY_KEY}");
  });
});

describe("getEnvFormat", () => {
  it("returns standard for claude-code", () => {
    expect(getEnvFormat("claude-code")).toBe("standard");
  });

  it("returns codex for codex", () => {
    expect(getEnvFormat("codex")).toBe("codex");
  });

  it("returns literal for devin", () => {
    expect(getEnvFormat("devin")).toBe("literal");
  });

  it("defaults to standard for unknown agents", () => {
    expect(getEnvFormat("unknown-agent")).toBe("standard");
  });
});

describe("convertEnvVars", () => {
  it("rewrites bare ${VAR} to ${VAR:-} for standard agents and returns new object", () => {
    // The standard-format short-circuit was removed (slice: resilient-placeholders)
    // because `fromCanonical("standard")` now applies `makeResilient`. Bare ${SECRET}
    // becomes ${SECRET:-} to prevent strict importers (Devin) from crashing on unset
    // env vars. Reference equality is preserved when nothing changes.
    const env = { API_KEY: "${SECRET}", PATH: "/usr/bin" };
    const result = convertEnvVars(env, "claude-code");
    expect(result).toEqual({ API_KEY: "${SECRET:-}", PATH: "/usr/bin" });
    expect(result).not.toBe(env);
  });

  it("returns same reference when already resilient (no transform needed)", () => {
    const env = { API_KEY: "${SECRET:-}", PATH: "/usr/bin" };
    expect(convertEnvVars(env, "claude-code")).toBe(env);
  });

  it("converts env vars for codex agent", () => {
    const env = { API_KEY: "${SECRET}", PLAIN: "no-vars" };
    const result = convertEnvVars(env, "codex");
    expect(result.API_KEY).toBe("{env:SECRET}");
    expect(result.PLAIN).toBe("no-vars");
  });

  it("normalizes non-canonical input before converting", () => {
    const env = { KEY: "${env:SECRET}" };
    const result = convertEnvVars(env, "codex");
    expect(result.KEY).toBe("{env:SECRET}");
  });

  it("resolves literal values for devin agent", () => {
    process.env.DEVIN_TEST_SECRET = "actual-value";
    const env = { TOKEN: "${DEVIN_TEST_SECRET}", PLAIN: "no-vars" };
    const result = convertEnvVars(env, "devin");
    expect(result.TOKEN).toBe("actual-value");
    expect(result.PLAIN).toBe("no-vars");
    delete process.env.DEVIN_TEST_SECRET;
  });

  it("resolves ${VAR:-default} to default for devin when var is unset", () => {
    delete process.env.DEVIN_MISSING;
    const env = { TOKEN: "${DEVIN_MISSING:-my-default}" };
    const result = convertEnvVars(env, "devin");
    expect(result.TOKEN).toBe("my-default");
  });
});

describe("convertServerEnvVars", () => {
  it("rewrites bare ${VAR} to ${VAR:-} for standard agents and returns new object", () => {
    // Same rationale as convertEnvVars — the standard-format short-circuit was removed
    // so adapters writing to ~/.claude.json / ~/.cursor/mcp.json emit resilient placeholders
    // that don't crash Devin's import-time interpolator on unset env vars.
    const env = { API_KEY: "${SECRET}", PATH: "/usr/bin" };
    const result = convertServerEnvVars(env, "claude-code");
    expect(result).toEqual({ API_KEY: "${SECRET:-}", PATH: "/usr/bin" });
    expect(result).not.toBe(env);
  });

  it("returns same reference when already resilient (no transform needed)", () => {
    const env = { API_KEY: "${SECRET:-}", PATH: "/usr/bin" };
    expect(convertServerEnvVars(env, "claude-code")).toBe(env);
  });

  it("omits Devin placeholder-backed env keys that the MCP child inherits from the launching shell", () => {
    const previous = process.env.DEVIN_INHERITED_SECRET;
    process.env.DEVIN_INHERITED_SECRET = "do-not-write-me";
    try {
      const env = {
        DEVIN_INHERITED_SECRET: "${DEVIN_INHERITED_SECRET}",
        APP_ENV: "dev",
      };
      const result = convertServerEnvVars(env, "devin");
      expect(result).toEqual({ APP_ENV: "dev" });
      expect(JSON.stringify(result)).not.toContain("do-not-write-me");
    } finally {
      if (previous === undefined) delete process.env.DEVIN_INHERITED_SECRET;
      else process.env.DEVIN_INHERITED_SECRET = previous;
    }
  });

  it("keeps Devin defaults when no inherited shell value exists", () => {
    delete process.env.DEVIN_DEFAULTED_ENV;
    const result = convertServerEnvVars({ DEVIN_DEFAULTED_ENV: "${DEVIN_DEFAULTED_ENV:-dev}" }, "devin");
    expect(result).toEqual({ DEVIN_DEFAULTED_ENV: "dev" });
  });

  it("omits Devin defaults when the launching shell provides the variable", () => {
    const previous = process.env.DEVIN_DEFAULTED_ENV;
    process.env.DEVIN_DEFAULTED_ENV = "prod";
    try {
      const result = convertServerEnvVars({ DEVIN_DEFAULTED_ENV: "${DEVIN_DEFAULTED_ENV:-dev}" }, "devin");
      expect(result).toEqual({});
    } finally {
      if (previous === undefined) delete process.env.DEVIN_DEFAULTED_ENV;
      else process.env.DEVIN_DEFAULTED_ENV = previous;
    }
  });
});

describe("getInheritedServerEnvKeys", () => {
  it("returns Devin env keys that should be inherited instead of persisted", () => {
    const previous = process.env.DEVIN_INHERITED_KEY;
    process.env.DEVIN_INHERITED_KEY = "available";
    try {
      const result = getInheritedServerEnvKeys(
        {
          DEVIN_INHERITED_KEY: "${DEVIN_INHERITED_KEY}",
          APP_ENV: "dev",
        },
        "devin",
      );
      expect(result).toEqual(["DEVIN_INHERITED_KEY"]);
    } finally {
      if (previous === undefined) delete process.env.DEVIN_INHERITED_KEY;
      else process.env.DEVIN_INHERITED_KEY = previous;
    }
  });

  it("returns no inherited keys for non-literal agents", () => {
    const previous = process.env.DEVIN_INHERITED_KEY;
    process.env.DEVIN_INHERITED_KEY = "available";
    try {
      expect(getInheritedServerEnvKeys({ DEVIN_INHERITED_KEY: "${DEVIN_INHERITED_KEY}" }, "cursor")).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.DEVIN_INHERITED_KEY;
      else process.env.DEVIN_INHERITED_KEY = previous;
    }
  });
});

describe("hasUnresolvedLiterals", () => {
  it("returns false for plain strings without placeholders", () => {
    expect(hasUnresolvedLiterals("plain-value")).toBe(false);
  });

  it("returns false when all referenced vars are set", () => {
    process.env.HUL_TEST_VAR = "resolved";
    expect(hasUnresolvedLiterals("prefix-${HUL_TEST_VAR}-suffix")).toBe(false);
    delete process.env.HUL_TEST_VAR;
  });

  it("returns true when a referenced var is not set", () => {
    delete process.env.HUL_MISSING_VAR;
    expect(hasUnresolvedLiterals("Bearer ${HUL_MISSING_VAR}")).toBe(true);
  });

  it("returns true when a referenced var is set to empty string", () => {
    process.env.HUL_EMPTY_VAR = "";
    expect(hasUnresolvedLiterals("${HUL_EMPTY_VAR}")).toBe(true);
    delete process.env.HUL_EMPTY_VAR;
  });

  it("returns true when any var in a multi-var string is unresolved", () => {
    process.env.HUL_RESOLVED = "ok";
    delete process.env.HUL_MISSING;
    expect(hasUnresolvedLiterals("${HUL_RESOLVED},${HUL_MISSING}")).toBe(true);
    delete process.env.HUL_RESOLVED;
  });

  it("returns false for ${VAR:-default} when var is unset (default provides a value)", () => {
    delete process.env.HUL_WITH_DEFAULT;
    expect(hasUnresolvedLiterals("${HUL_WITH_DEFAULT:-fallback}")).toBe(false);
  });

  it("returns true for ${VAR:-} with empty default when var is unset", () => {
    delete process.env.HUL_EMPTY_DEFAULT;
    expect(hasUnresolvedLiterals("${HUL_EMPTY_DEFAULT:-}")).toBe(false);
  });
});

describe("resolveEnvVar", () => {
  it("returns process.env value when set", () => {
    process.env.RESOLVE_TEST_VAR = "from-env";
    expect(resolveEnvVar("RESOLVE_TEST_VAR")).toBe("from-env");
    delete process.env.RESOLVE_TEST_VAR;
  });

  it("returns undefined for unknown vars not in env or fallbacks", () => {
    delete process.env.TOTALLY_UNKNOWN_VAR;
    expect(resolveEnvVar("TOTALLY_UNKNOWN_VAR")).toBeUndefined();
  });

  it("skips fallback when env var is set", () => {
    process.env.GITHUB_TOKEN = "from-env";
    expect(resolveEnvVar("GITHUB_TOKEN")).toBe("from-env");
    delete process.env.GITHUB_TOKEN;
  });

  it("tries gh auth token fallback for GITHUB_TOKEN when env is empty", () => {
    delete process.env.GITHUB_TOKEN;
    // The fallback calls `gh auth token` — result depends on gh CLI state
    // Just verify it doesn't throw
    const result = resolveEnvVar("GITHUB_TOKEN");
    expect(typeof result === "string" || result === undefined).toBe(true);
  });

  it("tries gh auth token fallback for GITHUB_PERSONAL_ACCESS_TOKEN", () => {
    delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    const result = resolveEnvVar("GITHUB_PERSONAL_ACCESS_TOKEN");
    expect(typeof result === "string" || result === undefined).toBe(true);
  });

  it("tries macOS Keychain fallback for SLACK_BOT_TOKEN when env is empty", () => {
    delete process.env.SLACK_BOT_TOKEN;
    // Calls `security find-generic-password` — returns token or undefined without throwing
    const result = resolveEnvVar("SLACK_BOT_TOKEN");
    expect(typeof result === "string" || result === undefined).toBe(true);
  });

  it("tries macOS Keychain fallback for SLACK_USER_TOKEN when env is empty", () => {
    delete process.env.SLACK_USER_TOKEN;
    const result = resolveEnvVar("SLACK_USER_TOKEN");
    expect(typeof result === "string" || result === undefined).toBe(true);
  });

  it("returns SLACK_BOT_TOKEN from process.env without hitting Keychain", () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-from-env";
    expect(resolveEnvVar("SLACK_BOT_TOKEN")).toBe("xoxb-from-env");
    delete process.env.SLACK_BOT_TOKEN;
  });

  it("returns SLACK_USER_TOKEN from process.env without hitting Keychain", () => {
    process.env.SLACK_USER_TOKEN = "xoxp-from-env";
    expect(resolveEnvVar("SLACK_USER_TOKEN")).toBe("xoxp-from-env");
    delete process.env.SLACK_USER_TOKEN;
  });

  it("tries macOS Keychain fallback for JIRA_URL when env is empty", () => {
    delete process.env.JIRA_URL;
    const result = resolveEnvVar("JIRA_URL");
    expect(typeof result === "string" || result === undefined).toBe(true);
  });

  it("tries macOS Keychain fallback for JIRA_USERNAME when env is empty", () => {
    delete process.env.JIRA_USERNAME;
    const result = resolveEnvVar("JIRA_USERNAME");
    expect(typeof result === "string" || result === undefined).toBe(true);
  });

  it("tries macOS Keychain fallback for JIRA_API_TOKEN when env is empty", () => {
    delete process.env.JIRA_API_TOKEN;
    const result = resolveEnvVar("JIRA_API_TOKEN");
    expect(typeof result === "string" || result === undefined).toBe(true);
  });

  it("returns JIRA_URL from process.env without hitting Keychain", () => {
    process.env.JIRA_URL = "https://jira.example.com";
    expect(resolveEnvVar("JIRA_URL")).toBe("https://jira.example.com");
    delete process.env.JIRA_URL;
  });

  it("returns JIRA_API_TOKEN from process.env without hitting Keychain", () => {
    process.env.JIRA_API_TOKEN = "token-from-env";
    expect(resolveEnvVar("JIRA_API_TOKEN")).toBe("token-from-env");
    delete process.env.JIRA_API_TOKEN;
  });

  it("falls back JIRA_EMAIL to JIRA_USERNAME in process.env (Atlassian Cloud alias — PR #1147)", () => {
    const prevEmail = process.env.JIRA_EMAIL;
    const prevUser = process.env.JIRA_USERNAME;
    delete process.env.JIRA_EMAIL;
    process.env.JIRA_USERNAME = "fyodor@example.com";
    try {
      expect(resolveEnvVar("JIRA_EMAIL")).toBe("fyodor@example.com");
    } finally {
      if (prevEmail !== undefined) process.env.JIRA_EMAIL = prevEmail;
      if (prevUser === undefined) delete process.env.JIRA_USERNAME;
      else process.env.JIRA_USERNAME = prevUser;
    }
  });

  it("falls back JIRA_BASE_URL to JIRA_URL in process.env (jira-mcp vs atlassian alias — PR #1147)", () => {
    const prevBase = process.env.JIRA_BASE_URL;
    const prevUrl = process.env.JIRA_URL;
    delete process.env.JIRA_BASE_URL;
    process.env.JIRA_URL = "https://jira.example.com";
    try {
      expect(resolveEnvVar("JIRA_BASE_URL")).toBe("https://jira.example.com");
    } finally {
      if (prevBase !== undefined) process.env.JIRA_BASE_URL = prevBase;
      if (prevUrl === undefined) delete process.env.JIRA_URL;
      else process.env.JIRA_URL = prevUrl;
    }
  });

  it("returns JIRA_EMAIL from process.env directly without hitting fallback chain", () => {
    process.env.JIRA_EMAIL = "explicit@example.com";
    process.env.JIRA_USERNAME = "should-not-be-used@example.com";
    try {
      expect(resolveEnvVar("JIRA_EMAIL")).toBe("explicit@example.com");
    } finally {
      delete process.env.JIRA_EMAIL;
      delete process.env.JIRA_USERNAME;
    }
  });
});

describe("containsPlaceholder", () => {
  it("detects ${VAR} as a placeholder", () => {
    expect(containsPlaceholder("${GITHUB_TOKEN}")).toBe(true);
  });

  it("detects placeholder embedded in a string", () => {
    expect(containsPlaceholder("Bearer ${API_KEY}")).toBe(true);
  });

  it("returns false for a resolved token", () => {
    expect(containsPlaceholder("ghp_abc123def456")).toBe(false);
  });

  it("returns false for non-string values", () => {
    expect(containsPlaceholder(42)).toBe(false);
    expect(containsPlaceholder(undefined)).toBe(false);
    expect(containsPlaceholder(null)).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(containsPlaceholder("")).toBe(false);
  });

  it("works correctly when called multiple times (lastIndex reset)", () => {
    expect(containsPlaceholder("${A}")).toBe(true);
    expect(containsPlaceholder("${B}")).toBe(true);
    expect(containsPlaceholder("plain")).toBe(false);
  });
});

describe("mergeEnvPreservingResolved", () => {
  it("preserves user-resolved value when incoming is a placeholder", () => {
    const existing = { GITHUB_TOKEN: "ghp_abc123" };
    const desired = { GITHUB_TOKEN: "${GITHUB_TOKEN}" };
    expect(mergeEnvPreservingResolved(existing, desired)).toEqual({ GITHUB_TOKEN: "ghp_abc123" });
  });

  it("allows placeholder to overwrite another placeholder", () => {
    const existing = { API_KEY: "${OLD_KEY}" };
    const desired = { API_KEY: "${NEW_KEY}" };
    expect(mergeEnvPreservingResolved(existing, desired)).toEqual({ API_KEY: "${NEW_KEY}" });
  });

  it("allows a concrete value to overwrite a placeholder", () => {
    const existing = { TOKEN: "${TOKEN}" };
    const desired = { TOKEN: "resolved-value" };
    expect(mergeEnvPreservingResolved(existing, desired)).toEqual({ TOKEN: "resolved-value" });
  });

  it("allows a concrete value to overwrite another concrete value", () => {
    const existing = { URL: "https://old.example.com" };
    const desired = { URL: "https://new.example.com" };
    expect(mergeEnvPreservingResolved(existing, desired)).toEqual({ URL: "https://new.example.com" });
  });

  it("adds new keys from desired", () => {
    const existing = { A: "val-a" };
    const desired = { B: "${B}" };
    expect(mergeEnvPreservingResolved(existing, desired)).toEqual({ A: "val-a", B: "${B}" });
  });

  it("preserves user-added keys not in desired", () => {
    const existing = { USER_KEY: "keep-me", MANAGED: "ghp_real" };
    const desired = { MANAGED: "${MANAGED}" };
    expect(mergeEnvPreservingResolved(existing, desired)).toEqual({ USER_KEY: "keep-me", MANAGED: "ghp_real" });
  });
});

// ── Bare-placeholder helpers (anti-Devin-import-crash) ──────────────────────
//
// These tests cover the helpers introduced to defuse the Devin CLI binary's
// import-time crash on bare `${VAR}` placeholders. The full rationale lives in
// `makeResilient`'s docstring; in short: Devin reads `~/.claude.json` and
// `~/.cursor/mcp.json` at startup, runs strict env-var interpolation, and
// aborts the entire MCP load (every server, including working ones like
// playwright and context7) when it hits a bare `${VAR}` whose env var is
// unset. The resilient `${VAR:-}` form makes Devin's regex see an empty
// default and proceed.

describe("BARE_PLACEHOLDER_PATTERN", () => {
  it("matches bare ${VAR} placeholders", () => {
    BARE_PLACEHOLDER_PATTERN.lastIndex = 0;
    const matches = "${A}-${B_C}-${D1E}".matchAll(BARE_PLACEHOLDER_PATTERN);
    expect(Array.from(matches).map((m) => m[1])).toEqual(["A", "B_C", "D1E"]);
  });

  it("does not match resilient ${VAR:-default} form (no false-positive rewrites)", () => {
    BARE_PLACEHOLDER_PATTERN.lastIndex = 0;
    expect("${VAR:-fallback}".match(BARE_PLACEHOLDER_PATTERN)).toBeNull();
  });

  it("does not match ${VAR:-} (empty default — already resilient)", () => {
    BARE_PLACEHOLDER_PATTERN.lastIndex = 0;
    expect("${VAR:-}".match(BARE_PLACEHOLDER_PATTERN)).toBeNull();
  });

  it("does not match opencode ${env:VAR} (different syntax)", () => {
    BARE_PLACEHOLDER_PATTERN.lastIndex = 0;
    expect("${env:VAR}".match(BARE_PLACEHOLDER_PATTERN)).toBeNull();
  });
});

describe("makeResilient", () => {
  it("rewrites bare ${VAR} to ${VAR:-}", () => {
    expect(makeResilient("${API_TOKEN}")).toBe("${API_TOKEN:-}");
  });

  it("leaves ${VAR:-default} untouched (already resilient)", () => {
    expect(makeResilient("${API_TOKEN:-fallback}")).toBe("${API_TOKEN:-fallback}");
  });

  it("leaves ${VAR:-} untouched (already resilient)", () => {
    expect(makeResilient("${API_TOKEN:-}")).toBe("${API_TOKEN:-}");
  });

  it("rewrites only bare placeholders when mixed with resilient ones", () => {
    expect(makeResilient("${A}-${B:-x}-${C}")).toBe("${A:-}-${B:-x}-${C:-}");
  });

  it("handles embedded placeholders inside larger strings", () => {
    expect(makeResilient("Bearer ${TOKEN}")).toBe("Bearer ${TOKEN:-}");
  });

  it("is idempotent — re-running produces the same output", () => {
    const once = makeResilient("${A}-${B}");
    expect(makeResilient(once)).toBe(once);
  });

  it("returns input unchanged when there are no placeholders", () => {
    expect(makeResilient("plain-value")).toBe("plain-value");
  });

  it("does not match lowercase placeholders (matches BARE_PLACEHOLDER_PATTERN convention)", () => {
    // The regex requires the first char to be uppercase letter or underscore.
    // Lowercase shell-style `${path}` is left alone — there's no convention that
    // agentbrew owns lowercase placeholders.
    expect(makeResilient("${path}")).toBe("${path}");
  });
});

describe("findBarePlaceholdersIn", () => {
  it("returns empty array when no placeholders are present", () => {
    expect(findBarePlaceholdersIn({ name: "ok", env: { K: "concrete" } })).toEqual([]);
  });

  it("finds placeholders in nested env values with dot paths", () => {
    const result = findBarePlaceholdersIn({
      env: { TOKEN: "${API_TOKEN}", URL: "${BASE_URL}/path" },
    });
    expect(result).toEqual([
      { path: "env.TOKEN", varName: "API_TOKEN", value: "${API_TOKEN}" },
      { path: "env.URL", varName: "BASE_URL", value: "${BASE_URL}/path" },
    ]);
  });

  it("uses array index notation for placeholders inside arrays", () => {
    expect(findBarePlaceholdersIn({ args: ["--token", "${TOKEN}"] })).toEqual([
      { path: "args[1]", varName: "TOKEN", value: "${TOKEN}" },
    ]);
  });

  it("skips already-resilient placeholders (the whole point of the sweep)", () => {
    expect(findBarePlaceholdersIn({ env: { K: "${API_TOKEN:-}" } })).toEqual([]);
  });

  it("walks deeply nested structures (Claude per-project mcpServers shape)", () => {
    const config = {
      projects: {
        "/home/user/proj": {
          mcpServers: { jenkins: { env: { JENKINS_API_TOKEN: "${JENKINS_API_TOKEN}" } } },
        },
      },
    };
    expect(findBarePlaceholdersIn(config)).toEqual([
      {
        path: "projects./home/user/proj.mcpServers.jenkins.env.JENKINS_API_TOKEN",
        varName: "JENKINS_API_TOKEN",
        value: "${JENKINS_API_TOKEN}",
      },
    ]);
  });

  it("returns multiple findings when a single string has multiple placeholders", () => {
    expect(findBarePlaceholdersIn({ url: "${HOST}:${PORT}/api" })).toEqual([
      { path: "url", varName: "HOST", value: "${HOST}:${PORT}/api" },
      { path: "url", varName: "PORT", value: "${HOST}:${PORT}/api" },
    ]);
  });
});

describe("applyResilientToValue", () => {
  it("rewrites placeholders in deeply nested object", () => {
    const before = {
      env: { TOKEN: "${TOKEN}", URL: "${URL:-https://default.example}" },
      args: ["--key=${KEY}", "--plain"],
    };
    const after = applyResilientToValue(before);
    expect(after).toEqual({
      env: { TOKEN: "${TOKEN:-}", URL: "${URL:-https://default.example}" },
      args: ["--key=${KEY:-}", "--plain"],
    });
  });

  it("returns the same reference when nothing needs rewriting (cheap clean check)", () => {
    // This is the contract callers rely on to skip writes when the file is already clean.
    const before = { env: { TOKEN: "${TOKEN:-}" } };
    expect(applyResilientToValue(before)).toBe(before);
  });

  it("returns a new reference when at least one rewrite happened", () => {
    const before = { env: { TOKEN: "${TOKEN}" } };
    expect(applyResilientToValue(before)).not.toBe(before);
  });

  it("preserves non-string primitives (numbers, booleans, null)", () => {
    const before = { count: 5, enabled: true, missing: null, name: "${VAR}" };
    expect(applyResilientToValue(before)).toEqual({
      count: 5,
      enabled: true,
      missing: null,
      name: "${VAR:-}",
    });
  });

  it("is idempotent — second application produces same output", () => {
    const once = applyResilientToValue({ env: { A: "${A}", B: "${B:-y}" } });
    expect(applyResilientToValue(once)).toEqual(once);
  });
});
