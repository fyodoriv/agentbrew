
# Unregister a command source by its path

[Issue #905](https://github.com/fyodoriv/agentbrew/issues/905) reports
a command-source path that stays registered in state after its declaration
was removed. The normal remove command can drop a command source by a
deployed command's label. The explicit path fails resolution even when
it exactly matches a command source record.

- **Hypothesis:** The normal remove path can drop one exact stale source
  registration after the owner removes its declaration. A shared label
  in a different directory stays registered.
- **Measurement:** Run `npm exec -- vitest run src/remove.test.ts src/commands/cli-core.test.ts`
  in hosted CI. Exercise the absolute path, dry run, declined confirmation,
  missing match, and another source with the same label.
- **Success:** The explicit accepted operation drops exactly one
  registration. The same-label neighbor is retained. Dry run, a decline,
  and an unknown path write zero settings and delete zero source files.
- **Pivot:** If a path can change an unrelated registration or a still
  declared source can disappear from the owner configuration, require
  the user to remove the source from its owning Agentfile before clearing
  the stale state entry.
- **Anchor:** [Issue #905](https://github.com/fyodoriv/agentbrew/issues/905),
  [the label removal control](https://github.com/fyodoriv/agentbrew/blob/8fe1f4fbce35b83c709e8ebd46677ad9f11ebf14/src/remove.test.ts),
  and the command-source ownership contract in the README.
