# Default model

agentbrew writes one model id to each agent that has a model setting.

## Set the model

1. Add `defaultModel` to your Agentfile.
2. Run `agentbrew sync`.
3. Run `agentbrew status` to check for drift.

Some agents keep the model in app state. agentbrew does not change it.
