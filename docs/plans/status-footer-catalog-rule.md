# Optional status footer

- **Hypothesis**: Users can install one shared status footer rule through the catalog.
- **Measurement**: Run `npm run verify` in hosted CI. The delivery-rule fixture installs the selected rule and reads it back in Claude Code and Codex.
- **Success**: One catalog entry, zero default installs, and one rule block in each of two primary hosts after explicit selection. The block names all three labels and checks live watcher and answer evidence.
- **Pivot**: If one existing user receives the rule by default, keep it out of the recommended set and review the install route before delivery.
- **Anchor**: [Status footer rule #962](https://github.com/fyodoriv/agentbrew/issues/962) and the optional delivery rule fixtures in `src/sync/judged-delivery-rules.test.ts`.

This change covers explicit user selection. [Plugin selection #826](https://github.com/fyodoriv/agentbrew/issues/826) tracks how signed plugins select core opt-in rules.
