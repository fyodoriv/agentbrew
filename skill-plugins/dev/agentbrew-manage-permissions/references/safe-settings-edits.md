# Edit settings.json Safely

1. Read the file first. Merge the new entry into what is there; never
   rewrite the whole file. Back up before a large change
   (`cp ~/.claude/settings.json ~/.claude/settings.json.bak-$(date +%Y%m%d-%H%M%S)`).
2. Make a small diff with the editor tool. A shell heredoc that rewrites
   `settings.json` and adds allow rules can be refused by an agent's safety
   check as self-modification.
3. Ask the user before you add an `allow` rule or a hook. When a gate
   refuses an action, report what was refused and what the user must
   approve; do not retry it or work around it.
4. Validate: `jq . ~/.claude/settings.json`. Invalid JSON makes Claude Code
   ignore every setting in the file.
5. Writes under `~/.claude/` are protected: allow rules do not cover them
   (the memory directory is the exception). Edit them in an interactive
   session, not in a `claude -p` run.
