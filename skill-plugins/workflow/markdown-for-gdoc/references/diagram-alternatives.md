# Diagram alternatives for Google Docs

Google Docs uses proportional fonts, so ASCII art misaligns. Use these forms instead.

1. **Nested bullet lists** — describe layout hierarchically:
   ```markdown
   The app UI has three main areas:
   - **TopNav** — horizontal bar at the top
     - **Menu** (top-left) — `primaryItems` and `secondaryItems`, each linking to a scene
     - **Tools** (top-right) — messaging, notes, tasks
   - **Scene** (main area) — full page views like engagement view, dashboard, case view
     - **Command Center** — toolbar with tool buttons, search, slash commands (AI Native only)
   ```

2. **Simple tables** — for grid-like layouts:
   ```markdown
   | Area | Position | Contents |
   |---|---|---|
   | Menu | Top-left | primaryItems, secondaryItems |
   | Tools | Top-right | messaging, notes, tasks |
   | Scene | Main area | engagementView, dashboard, caseView |
   ```

3. **Prose description** — when structure is simple enough to describe in a sentence or two.
