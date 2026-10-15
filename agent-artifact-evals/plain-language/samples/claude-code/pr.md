## Summary

Status did not show a changed model. This PR adds a `models` drift check. Users now see the change before sync repairs it.

## Details

- Add `checkModelsDrift` in `src/drift-checks/models.ts`.
- Run `syncModels` in `agentbrew status --fix`.

## Docs

- README "Agentfile" section.
