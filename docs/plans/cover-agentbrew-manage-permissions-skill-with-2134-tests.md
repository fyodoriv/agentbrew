# Cover agentbrew-manage-permissions skill with #2134-style tests

## Goal

Add deterministic regression coverage for `skill-plugins/dev/agentbrew-manage-permissions/` so Claude Code permission-management guidance, safety boundaries, and eval metadata drift fails in CI.

## Why

This skill steers agents through direct edits to `~/.claude/settings.json`, a high-risk surface because overly broad permission patterns can grant unrestricted MCP/tool/shell access, and removing core tools can break the agent. A #2134-style contract spec should catch accidental weakening of:

- current permission inspection via `agentbrew status` and `~/.claude/settings.json`;
- the `permissions.allow` versus `permissions.deny` distinction;
- scoped permission patterns for MCP tools, Bash globs, and built-in tools;
- the preferred `agentbrew mcp add <server>` + `agentbrew sync` flow for MCP server permissions;
- direct manual settings edits only for built-in tools, Bash patterns, and fine-grained exceptions;
- targeted deny-list behavior and `deny` overriding `allow`;
- least-privilege pattern guidance;
- prohibitions on broad wildcards like `mcp__*` and `Bash(*)`;
- safeguards around Read, Write, and Edit permissions;
- required `agentbrew status --fix` verification after manual edits.

## Scope in

- Add a Vitest deterministic contract spec at `src/skills/agentbrew-manage-permissions-contract.test.ts`, the same `src/skills/` harness used by existing #2134-style specs.
- Read the real `SKILL.md` and `evals/evals.json` from disk.
- Follow the established #2134-style pattern: load artifact files, assert critical prose and metadata with grouped `requireTerms` checks, use exact strings for commands/paths/flags, use regexes for wrapping-prone prose, and locate eval scenarios by prompt/expected-output/expectation text.
- Assert required SKILL.md contract content:
  - trigger scope for managing Claude Code tool permissions, reviewing allowed/denied tools, adding MCP server permissions, allowing/blocking tools, and listing allowed tools;
  - `~/.claude/settings.json` as the manual permissions surface, with MCP server permissions auto-managed by agentbrew and manual edits only for edge cases/fine-grained control;
  - current permission checks via `agentbrew status` and `cat ~/.claude/settings.json`;
  - `permissions.allow` and `permissions.deny` arrays;
  - pattern reference for `mcp__server-name__*`, `mcp__server-name__tool-name`, `Bash(git *)`, `Bash(yarn *)`, `Read`, `Write`, `Edit`, `WebFetch`, and `WebSearch`;
  - add-permission path for MCP servers via `agentbrew mcp add <server>` and `agentbrew sync`;
  - manual edit path for Bash patterns and built-in tools, followed by `agentbrew status --fix`;
  - remove-permission and deny-tool flows;
  - rules for most-specific patterns, MCP auto-handling, explicit user request before removing Read/Write/Edit, always running `agentbrew status --fix`, and `deny` overriding `allow`;
  - constraints against broad wildcards, manual MCP edits, removing core tools without explicit request, and skipping verification.
- Assert eval metadata coverage:
  - positive permission-review case;
  - positive scoped MCP add/sync case;
  - targeted deny-list case;
  - broad-wildcard refusal case. The current three evals do not explicitly cover refusal to add `mcp__*` / `Bash(*)`, so a fourth eval MUST be added;
  - core-tool-removal ambiguity/safety case. Add a fifth eval to cover explicit-request handling and alternatives before removing Read/Write/Edit.

## Scope out

- Do not change agentbrew permission-sync implementation.
- Do not edit live `~/.claude/settings.json`.
- Do not add executable scripts just to satisfy the pattern.
- Do not run live agent evals as part of this deterministic slice.
- Do not extract shared helpers in this P0; the existing P2 scout tracks helper extraction.

## Implementation steps

1. Add `src/skills/agentbrew-manage-permissions-contract.test.ts` beside the existing skill contract specs.
2. Write deterministic tests against `SKILL.md` and `evals/evals.json` with grouped, actionable assertions.
3. Add mandatory eval #4 for broad wildcard refusal.
4. Add eval #5 for ambiguous/core-tool removal safety handling.
5. Avoid SKILL.md prose edits; inspection confirms the current skill already includes the safety-critical contract terms.
6. Run:
   - `npx vitest run src/skills/agentbrew-manage-permissions-contract.test.ts`
   - `npm run skills:coverage`
   - `npm run verify`
7. Remove the completed task block from `TASKS.md` before the implementation commit and update the shared-helper scout count if another local helper copy exists.

## Current artifact check

- Existing `SKILL.md` already documents all required safety-critical terms: inspection, settings path, allow/deny arrays, scoped patterns, MCP auto-management, manual edit boundaries, targeted deny, least privilege, broad wildcard prohibition, core tool safeguards, and status-fix verification.
- Existing evals cover three non-refusal paths: permission review, scoped MCP add/sync, and targeted deny-list. They do not cover broad wildcard refusal or core-tool-removal ambiguity, so evals #4 and #5 are required.
- `src/skills/` is the active skill-contract-test harness location, with five existing #2134-style specs using the same placement.
- `npm run verify` is the final completion gate after focused tests and `npm run skills:coverage`.

## Risks and mitigations

- **Brittle phrase locks**: Use exact strings for commands/paths/patterns and regexes for wrapping-prone prose.
- **Over-scoping into live permissions**: Keep this artifact-contract only; never edit real Claude settings during tests.
- **False confidence**: State that the spec proves skill/eval drift detection, not that a live permission change succeeded.
- **Duplicate helpers**: Accept local duplication for this P0; update the existing scout task instead of extracting now.

## Acceptance criteria

- A new deterministic spec reads `SKILL.md` and `evals/evals.json`.
- The spec pins permission inspection, allow/deny semantics, scoped pattern examples, MCP auto-management, manual edit boundaries, deny precedence, broad wildcard refusal, Read/Write/Edit safeguards, and `agentbrew status --fix` verification.
- Evals cover permission review, scoped MCP add/sync, targeted deny-list, broad wildcard refusal, and core-tool-removal ambiguity/safety handling.
- `npx vitest run src/skills/agentbrew-manage-permissions-contract.test.ts` passes.
- `npm run skills:coverage` passes.
- `npm run verify` passes.
- Completed task is removed from `TASKS.md`.

## Vision trace

- **Vision goal**: G5 — Drift detection + auto-repair. This adds CI-visible drift detection for an agent-facing permission-management workflow artifact.
- **User story**: `docs/user-stories/18-lint-validate.md`; validation should catch broken agent artifacts before users rely on them.
- **Competitor prior art**: N/A — this is internal deterministic regression coverage for an agentbrew-owned skill, not a user-facing feature proposal.

## Reviewer verdict

- **Verdict**: approved
- **Reviewer**: reviewer
- **Date**: 2026-06-10
- **Concerns**:
  - None blocking. Plan scope, artifact checks, required eval additions, implementation steps, verification gates, and vision trace are complete.
