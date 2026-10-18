# Add a Source

> I point agentbrew at a GitHub repo or folder and it indexes skills, MCP servers, rules, and commands.

**Metric**: `story_fail_rate` for US02 in [`metrics.md`](../metrics.md): `install <repo>` is the same command as US02.

**E2E**: [`us07-us17-source-and-existing-setup.test.ts`](../../real-e2e/scenarios/us07-us17-source-and-existing-setup.test.ts)

```bash
agentbrew install vercel-labs/agent-skills    # GitHub repo
agentbrew install ~/my-company/skills         # local folder
agentbrew install obra/superpowers            # any public repo

# Then install from it
agentbrew install react-best-practices
agentbrew catalog                          # browse all sources
```

## How it works

`install` clones (or reads) the source, scans for skills, MCP servers, rules, and commands, indexes them in state, and makes them available via `catalog` and `install`. Sources are refreshed on `agentbrew sync --pull`.

Adding a source never modifies your existing agent config. Skills are only deployed when you explicitly `install` them, and your manual edits to agent config files are always preserved.

Built-in sources (auto-indexed): Anthropic, Vercel Labs, obra/superpowers, Supabase, Trail of Bits, OpenAI, Microsoft, HuggingFace, and more. See `src/sources.yaml` for the full list.
