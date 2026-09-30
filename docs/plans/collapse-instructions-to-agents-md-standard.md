# Plan: collapse-instructions-to-agents-md-standard

## Goal

Deploy one canonical `~/.config/agentbrew/AGENTS.md` and symlink every agent whose `rulesFile` is the cross-tool `AGENTS.md` standard. Keep copy+merge only for proprietary instruction filenames (`CLAUDE.md`, `global_rules.md`, `guidelines.md`, `GEMINI.md`) and the ChatGPT/Claude Desktop context-file transforms.

## Vision trace

- **Vision goal**: G1/G6 + VISION § "Simple beats clever"
- **User story**: US 04 (share rules) / instructions surface
- **Competitor prior art**: agents.md standard; agents_sync/Ruler/Cyncia pivot to AGENTS.md

## Scope (in)

- `CANONICAL_INSTRUCTIONS_PATH` in `src/paths.ts`
- `instructions-sync.ts`: write canonical once, symlink AGENTS.md targets, copy-merge carve-outs
- `drift-checks/instructions.ts`: resolve symlinks to canonical for drift
- Remove unused `extractSharedInstructions`
- Tests, README Instructions row, CHANGELOG, TASKS.md removal

## Scope (out)

- rules-sync managed-section logic (unchanged)
- `compressSkillsListing` / `stripCursorRulesSection` (rules-sync + measure; stay)
- Context file generation (`extractCursorRules` carve-out for paste formats)

## Carve-outs (one-line reasons)

| Target | Reason |
|--------|--------|
| `CLAUDE.md` | Claude Code/Desktop expect this filename at `~/.claude/` |
| `global_rules.md` | Windsurf memories path, not AGENTS.md |
| `guidelines.md` | Augment guidelines format path |
| `GEMINI.md` | Gemini CLI instructions filename |
| `context/chatgpt.md`, `context/claude-desktop.md` | Proprietary paste formats (Custom/Project Instructions) |

## Acceptance

- (a) AGENTS.md-path agents get symlinks to canonical, not transformed copies
- (b) Each surviving copy path has a documented reason in code
- (c) Record LOC delta in CHANGELOG
- (d) User content outside markers preserved via canonical merge
- (e) `npm run verify` passes
