# Native Codex command skill experiment

The installed Codex0.166.0 rejects `/prompts:ship-it` although the managed
prompt file exists. Current docs deprecate custom prompts and recommend
skills. Native `/presets` offers ten numbered slots, not sixteen named
workflow entries. Three private source-command skills already exist; they
are owner files and must remain unchanged.

- **Hypothesis (GQM):** generate explicit-use Codex skill bridges from the
  same winning command sources. All16 managed workflows become natively
  discoverable and a harmless argument fixture executes as specified.
  Keep legacy prompt output for older clients and preserve owner content.
- **Measurement:** `heavy-run npm run verify`; native app-server skills/list
  with forceReload; a harmless generated command invoked with positional
  and quoted arguments through real Codex. Compare owner-file hashes and
  repeat-sync writes. Test source updates, unusual names, dry runs and
  owned-only stale pruning in unit fixtures.
- **Success:** 100% of winning managed commands have valid native bridges,
  zero skill parse errors, exact harmless fixture output, zero owner-file
  changes, and zero writes on unchanged repeat sync. All required gates pass.
- **Pivot:** if a native fixture is undiscoverable, argument output differs,
  any owner file changes, or a required gate fails, abandon the bridge
  implementation and use an upstream-supported workflow alternative. Do not
  claim file deployment proves command functionality.
- **Scope:** generated files are Codex command outputs under an ownership
  namespace. Lifecycle is per-user managed command deployment; existing
  hashes govern updates and pruning. Never recursively delete owner folders.
- **Anchor:** Basili, Caldiera and Rombach (1994), Goal-Question-Metric;
  Kohavi, Tang and Xu (2020), observable outcome verification.
