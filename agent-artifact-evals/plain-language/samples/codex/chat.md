Codex reads `model` from `~/.codex/config.toml`. Your file sets it twice, so the second value wins.

- Fix: delete the second `model` line.
- Check: run `codex --version` and start a new session.

**Needed from you:** nothing
