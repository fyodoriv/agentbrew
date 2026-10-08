# Discover & Import

> I manually add an MCP server to one agent and want it everywhere — agentbrew discovers it and syncs it to all others.

```bash
agentbrew sync                # bare sync warns about user-added servers
agentbrew sync --discover     # detailed listing of user-added servers
agentbrew import              # import from all agents into agentbrew state
agentbrew import --from cursor  # import from a specific agent
```

## How it works

Sync is bidirectional. The normal flow pushes agentbrew state to agents. Discovery reads agent configs back and finds servers not in state.

1. **Bare `agentbrew sync`** — after syncing, runs a lightweight discovery pass. If it finds servers in agent configs that aren't in agentbrew state, it prints a dim info line:
   ```
   ℹ <count> server(s) in agent configs not in agentbrew: my-server, other-srv
     Run `agentbrew sync --discover` for details or `agentbrew import` to sync them.
   ```

2. **`agentbrew sync --discover`** — shows a detailed listing with server names and which agent they were found in:
   ```
   Discovered <count> server(s) not in agentbrew:

     + my-server (found in cursor)
     + other-srv (found in codex)

     Run `agentbrew import` to add them to all agents.
   ```

3. **`agentbrew import`** — reads all agent configs, finds servers not in state, adds them to state, then auto-syncs so every agent gets them.

4. **`agentbrew status --fix`** — flags user-added MCP servers, skills, and commands as informational drift items with a suggestion to import.

Discovery is read-only and best-effort — it never modifies state or agent configs on its own.
