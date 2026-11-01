# Native command entry points

Deployed files do not prove command parity. A Codex client can load legacy
`~/.codex/prompts` files and still reject `/prompts:<name>` as unrecognized.
Check native skill discovery in a fresh client, then invoke a harmless,
disposable command fixture through its native skill entry point. Do not run
a publishing or destructive workflow only to test command discovery.

Codex command adapters use explicit `$agentbrew-command-<name>` syntax.
Their arguments are model-bound instructions, not automatic macro expansion.
Verify raw and quoted positional arguments in the harmless live invocation.
Keep legacy compatibility files and owner-managed `source-command-*` wrappers.
Change the adapter's source, then preview and sync; do not overwrite wrappers
to make a deployment count match. Claim parity only after native discovery
and the harmless live invocation both pass.

## Check context budgets before the full gate

When you edit agent guidance, run the existing guide and skill budget checks
before the expensive full gate. Keep the read trigger in `SKILL.md` and the
details in this reference. Do not increase budgets or baselines to fit prose.
