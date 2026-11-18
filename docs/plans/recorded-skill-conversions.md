# Report a recorded skill-to-plugin conversion

Trail of Bits [converted insecure-defaults in commit 82e8e0a](https://github.com/trailofbits/skills/commit/82e8e0a).
A refresh currently reports the old skill as missing. A matching name in
a marketplace is insufficient to infer that an arbitrary skill moved.

- **Hypothesis**: An explicit source and skill record changes two
  consecutive refresh messages from missing to migrated. The old
  installed copy and an unrelated copy keep their original bytes.
- **Measurement**: In hosted `src/update.test.ts`, refresh a synthetic
  GitHub source and run the same refresh twice. Include a matching skill
  still available in an earlier checkout and the same name at another
  source.
- **Success**: 2/2 migration messages name a documented next action.
  Copy and remove counts for retained files are zero. Same-named
  unrecorded and still-available skills keep their existing behavior.
- **Pivot**: Any incorrect classification or file mutation rejects
  automatic handling. Keep the explicit record and report its limitation.
- **Anchor**: The upstream commit, Agentbrew's ownership contract, and
  `classify-upstream-skill-plugin-conversions`.
