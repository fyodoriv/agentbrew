# Claude Code undocumented config surface — verified ledger

**Why this doc exists:** agentbrew generates Claude Code config — hooks into
`~/.claude/settings.json` (`src/sync/hooks-sync.ts`), agents into
`~/.claude/agents/*.md` (`src/sync/agents-sync.ts`), skills, and validates skill
frontmatter (`src/skills/validate.ts`). An article ("I Read the Claude Code
Source Code", buildingbetter.tech, 2026-04-01) listed a pile of undocumented
fields. Before turning any of it into agentbrew features, the claims were
checked against the **actually installed binary** so we don't build support for
fields that don't exist.

## Provenance / method

- **Verified against:** `~/.local/share/claude/versions/2.1.138` (the operator's
  installed Claude Code — newer than the article's `2.1.87`).
- **Method:** the binary is a single ~196 MB Bun-compiled executable. Verified
  by grepping embedded string literals (`grep -a -c -F <id>` and
  `strings -n 6 <bin> | grep -C2 <id>`) for each claimed identifier and
  inspecting surrounding context for the real config shape.
- **Re-run:** `strings -n 6 ~/.local/share/claude/versions/<ver> > /tmp/cc.txt`
  then `grep` the identifiers below. Counts will drift between versions —
  treat this as a snapshot, re-verify before relying on a field.

## ✅ Verified real (present + shape confirmed in 2.1.138)

| Surface | Fields | Notes |
|---|---|---|
| **Hook response JSON** (stdout) | `updatedInput`, `permissionDecision`, `permissionDecisionReason`, `additionalContext`, `updatedMCPToolOutput`, `watchPaths`, `initialUserMessage` | Event-specific. Lets a hook rewrite tool input, force allow/deny, inject context, set file watches, prepend to first user message. |
| **Hook control fields** | `async`, `asyncRewake`, `once`, `if`, `statusMessage`, `timeout` | `asyncRewake` = run in background, but exit 2 wakes the model and blocks. `once` = fire once then auto-remove. |
| **Skill frontmatter** | `effort` (`low`/`medium`/`high`/`max`), `model`, `agent`, scoped `hooks`, `disable-model-invocation`, `shell` | `effort` confirmed: all four levels present as literals. |
| **Agent frontmatter** | `memory` (`user`/`project`/`local` — confirmed `.claude/agent-memory-local/`), `color`, `omitClaudeMd`, `criticalSystemReminder_EXPERIMENTAL`, `requiredMcpServers` | `criticalSystemReminder_EXPERIMENTAL` is flagged unstable by its own name — do not build load-bearing infra on it. |
| **Settings (learning loop)** | `autoMemoryEnabled`, `autoDreamEnabled` | Auto-extract memories per session; consolidate ("dream") across sessions. |
| **Settings (auto mode)** | `autoMode.{allow, soft_deny, hard_deny, environment}`, `disableAutoMode` | `environment` is a plain-English context array the classifier reads. Confirmed template `<user_soft_deny_rules_to_replace>`. |
| **Forked skills** | `context: fork`, `CacheSafeParams` | Forks share the parent prompt-cache prefix; setting a different `model` on a fork breaks cache — use `model: inherit`. |

## ⚠️ Embellished by the article (concept real, detail wrong)

- **"YOLO Classifier" / `yoloClassifier.ts`** — NOT a real string (0 hits;
  lowercase `yolo` hits are noise inside a bundled Stata word list). The feature
  is real but is just called **auto mode** / `autoMode`. The catchy name is the
  author's invention.
- **`autoMode` shape** — the article listed `allow` / `soft_deny` / `environment`
  and **omitted `hard_deny`** (24 hits). The real shape is
  `{allow, soft_deny, hard_deny, environment}`.

## ❌ Not present in 2.1.138 (fabricated, or removed since 2.1.87)

- **"Magic Docs"** / the regex `/^#\s*MAGIC\s+DOC:\s*(.+)$/im` — NOT found.
  Every `MAGIC` hit is bundled file-magic-signature help text (ugrep/magika:
  "MAGIC BYTES", `--file-magic`). Do **not** build on this; if a future version
  reintroduces it, re-verify first.

## What this means for agentbrew (tasks filed)

- `skill-validator-claude-effort-shell-fields` (P2) — validator flags
  verified-real fields (`effort`, `shell`, `when_to_use`) as "unknown".
- `agentfile-hooks-async-rewake-control-fields` (P2) — `ManagedHook` /
  `ClaudeHookItem` drop the verified control fields (`async`, `asyncRewake`,
  `once`, `if`, `statusMessage`).
- `agentfile-claude-session-settings-sync` (P3, exploratory) — whether to let
  the Agentfile declare `autoMemoryEnabled` / `autoDreamEnabled` / `autoMode`
  and sync them like the existing settings.json hooks key.

Sibling dotfiles task: `claude-hook-updatedinput-mutate-vs-warn` (P2) — verify
PreToolUse `updatedInput` empirically and, if it works, collapse the WARN-hook +
MUTATE-wrapper into one mutating hook (corrects an AGENTS.md claim).
