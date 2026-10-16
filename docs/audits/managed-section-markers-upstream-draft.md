# Draft: ask other config tools to align on managed-section markers

- **Task**: `ecosystem-contrib-managed-section-convention`
- **Status**: draft, not posted. Posting is a public write on a third-party repo. The owner must approve each exact action.
- **Spec**: [`docs/specs/managed-section-markers.md`](../specs/managed-section-markers.md)

## First target: Caliber (`caliber-ai-org/ai-setup`)

Caliber already uses `<!-- caliber:managed:pre-commit -->` (checked 2026-10-16), which is the proposed format. So the ask is small: confirm the format and the ownership rules.

How to post (owner): `gh issue create -R caliber-ai-org/ai-setup --title "Shared managed-section marker convention" --body-file <file with the text below>`. Then paste the issue URL into the task block.

> **Shared managed-section marker convention**
>
> Caliber and agentbrew both write sections into `CLAUDE.md` and `AGENTS.md`. Caliber already uses `<!-- caliber:managed:<section> -->` / `<!-- /caliber:managed:<section> -->`. We would like to align on that format, plus four short rules: only the named tool edits its block; every other tool keeps it byte for byte; blocks are top-level and never nest; a tool stops on an unclosed block instead of guessing.
>
> The full text (one page, with a test regex) is here: https://github.com/fyodoriv/agentbrew/blob/main/docs/specs/managed-section-markers.md
>
> If you agree, agentbrew will move to `<!-- agentbrew:managed:<section> -->`. Nothing changes in Caliber. Happy to adjust the spec to match what you already do. This is a question, not a PR.

## Later targets

Only after Caliber answers. Same short text, adapted to each tool's current behavior. Check first whether each tool writes markers at all.
