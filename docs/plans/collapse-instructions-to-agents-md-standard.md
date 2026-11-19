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
- `compressSkillsListing` (rules-sync + measure; stay)
- Context file generation for paste formats

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

## Preserve existing files during link adoption

The first-run link writer replaced a separate Codex file after the first
Claude file seeded the canonical file. The disposable control retained
one of two owner markers. Link adoption should leave occupied paths
in place and seed a new canonical file without another agent's local text.

- **Hypothesis**: Missing paths and existing canonical links work as before.
  Separate files or links stay in place. First-run publication carries a
  verified managed rules block without importing local instructions.
- **Measurement**: Run `npx vitest run src/sync/instructions-sync.test.ts src/drift.test.ts src/status.test.ts`
  on hosted CI. Run the CLI's install, instructions preview, and retry in
  disposable homes. Use `sync --dry-run --only instructions --verbose` to see the kept
  result. Test matching, missing, and stale manifest records for managed rules.
- **Success**: Both local markers survive twice. Zero separate path changes
  occur during preview, and a fresh path links to its canonical file.
  A matching manifest permits one managed block and zero local markers in
  the fresh sibling. An absent manifest record admits zero blocks.
  Status reports kept paths without offering an automatic repair.
- **Pivot**: Any lost or copied local marker, wrong repair advice, foreign
  link replacement, missing managed block in the accepted control, or
  unexpected write rejects the candidate.
- **Anchor**: The original canonical layout contract above and the rules
  before instructions order in `src/sync-runner.ts`.
