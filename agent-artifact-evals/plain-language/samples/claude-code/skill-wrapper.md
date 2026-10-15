---
name: drift-check
description: Check agentbrew drift and repair it. Use when the user says "check drift".
---

# Drift check

Run `agentbrew status`. Read the drift list.

If the list is not empty, run `agentbrew status --fix`. Then run `agentbrew status` again.

Report each item that remains. Name the agent and the next command.
