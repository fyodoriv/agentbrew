# Visual verification: repairs and SSO handoff

Load this file during the visual verification loop in `SKILL.md`.

## Typical repairs

- `bullets: "remove"` on paragraphs wrongly absorbed into a list
- `docs_update_paragraph_style` with the exact `tab_id` and a **tighter**
  bullet range (lists often bleed one paragraph too far)
- `docs_update_paragraph_style` → `NORMAL_TEXT` on body paragraphs
- `delete_content_range` on empty styled paragraphs after headings
- `docs_unbold_paragraph_range` when `find_and_replace` split bold mid-word

## When the browser hits SSO

If browser hits SSO, run the initial attach-first poll. If still blocked,
open the doc URL in a stable **headed** SSO session and bring that Chrome
window forward before asking the user to sign in. Never describe a headless
CDP tab as visible. Start the `sso-background-work` URL/title/HTML listener
immediately after the handoff; do not wait for the user to say “done.”
Keep fixing from structured reads, then return to visual verification as soon
as the listener emits `SSO_AUTH_COMPLETE`.
