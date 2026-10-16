# Managed-section markers for shared agent config files

- **Status**: proposal, version 0.1 (2026-10-16). Not adopted by any other tool yet.
- **Task**: `ecosystem-contrib-managed-section-convention`
- **Goal**: several tools can write to one agent config file (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/*.mdc`, `GEMINI.md`) without overwriting each other.

## Problem

More than one tool now writes to the same agent instruction files. Each tool
picks its own markers, or none:

| Tool | Markers today (checked 2026-10-16) |
|---|---|
| agentbrew | `<!-- agentbrew:start -->` and `<!-- agentbrew:end -->` |
| Caliber (`caliber-ai-org/ai-setup`) | `<!-- caliber:managed:pre-commit -->` and `<!-- /caliber:managed:pre-commit -->` |
| Some tools | write the file directly, with no markers |

No shared rule says who may change which part of a file. A tool that rewrites
the whole file deletes the other tools' sections.

## 1. Marker format

A managed section starts and ends with an HTML comment on its own line:

```markdown
<!-- <tool>:managed:<section> -->
...content the tool owns...
<!-- /<tool>:managed:<section> -->
```

- `<tool>` is the tool's package or repo name in lowercase kebab-case (for example `agentbrew`, `caliber`).
- `<section>` is a kebab-case name that is unique for that tool in that file (for example `rules`, `pre-commit`).
- Markers are HTML comments, so Markdown renderers hide them and agents read them as plain text.
- A tool may keep its older markers as aliases while it migrates.

## 2. Ownership

- Only the tool named in the marker may change the content between its two markers.
- Every other tool must keep that block byte for byte, including the marker lines.
- Text outside every managed block belongs to the user. A tool must not change it, except to add or remove its own complete block.
- To remove its block, a tool deletes its start marker, its end marker, and the content between them. Nothing else.

## 3. Placement

- A block is a top-level part of the file. It starts at the beginning of a line and ends at the end of a line.
- The content may be any valid Markdown (headings, lists, code fences) for the host file.
- A tool adds a new block at the end of the file, after one blank line, unless the user moved it. A tool must keep a block where the user put it.

## 4. Nesting

- Blocks must not nest. A block may not contain another tool's markers or a second block of its own.
- When a tool finds a nested or unclosed block, it must stop and report the file. It must not guess where the block ends.

## 5. Test patterns

A block, for any tool and section:

```regex
^<!-- ([a-z0-9-]+):managed:([a-z0-9-]+) -->$[\s\S]*?^<!-- /\1:managed:\2 -->$
```

(Use multiline mode, so `^` and `$` match at each line.)

Checks a tool should run in its own tests:

1. **Round trip**: write the block into a file that holds another tool's block and user text. Only the bytes of its own block change.
2. **Foreign block kept**: a file with another tool's block keeps that block byte for byte after a sync.
3. **Remove**: removing the block leaves the user text and the other blocks byte for byte.
4. **Nested or unclosed block**: the tool reports an error and does not write the file.

agentbrew's isolation test today: `src/sync/marker-utils.test.ts`.

## Next steps

- agentbrew moves to `<!-- agentbrew:managed:<section> -->`, with `agentbrew:start` and `agentbrew:end` kept as aliases (a follow-up task, after another tool agrees to the format).
- Ask other tools to align. Draft texts: [`docs/audits/managed-section-markers-upstream-draft.md`](../audits/managed-section-markers-upstream-draft.md). Posting them is a public write that needs the owner's approval.
