# Verify in a Fresh Session

Some changes take effect only in a new session: the model, the effort level,
the memory directory, and skills or settings folders created mid-session (the
Skill tool answers "Unknown skill" until then; read that `SKILL.md` and follow
it by hand). Check them without restarting your own session:

```bash
# Model, memory paths, and loaded slash commands, from a fresh headless session
cd ~ && claude -p ok --output-format stream-json --verbose 2>/dev/null \
  | jq -c 'select(.subtype=="init") | {model, memory_paths, slash_commands}'
```

- Select the `init` line by `subtype`; SessionStart hook events come before
  it, so `head -1` is wrong.
- The effort level is not in the `init` line. Read it from the newest session
  log: `grep -o '"effort":"[a-z]*"' <newest ~/.claude/projects/*/*.jsonl> | sort | uniq -c`.
- To check a hook, pipe-test its command first (`echo '{}' | sh -c '<cmd>'`),
  then run `claude -p "Quote any '<marker text>' in your context, or say NONE"`.
- When the user names a model version, write the full model ID, not an alias.
