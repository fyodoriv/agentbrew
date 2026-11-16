# README checker source review prediction

A preliminary source scan found a Python checker invoked with a README path by
its skill. This is an observation, not a completed review or registry record.
Register the following before creating an oracle or changing the registry.

- **Hypothesis:** A complete independent review may establish that the exact
  pinned checker is a data parser compatible with the existing narrow compiled
  registry, without treating arbitrary Python or README content as executable.
- **Measurement:** Inspect the pinned file, all entry paths and the named skill
  caller; prepare a source-and-caller oracle, then independently review it
  against `rust/src/reviewed_sources.rs` and the registry contract. No analyzed
  source or physical worker runs during review.
- **Success:** One exact path and blob, whole-program and entry spans, data
  inputs/outputs, every relevant call and caller are accounted for; zero
  unexplained executable, write, generation or dynamic boundaries remain.
  The default path when no argument is supplied is represented or shown outside
  the claimed scope. The oracle and schema agree without changing either to
  conceal a boundary.
- **Pivot:** If any behavior or caller cannot be represented and independently
  justified, keep this source unresolved and do not add a complete record.
  A source review is not a passing inventory or worker qualification.
- **Anchor:** `docs/plans/rust-source-reviewed-registry.md`,
  `rust/src/reviewed_sources.rs`, `skill-plugins/workflow/readme/SKILL.md`,
  and Basili et al. (1994), Goal Question Metric.

## Source-only result and pivot

At revision `38618c71`, the checker blob is
`f608d61ec81014d112f374267897465b25e38722` and the skill blob is
`b927a6703e37f22faf69996795e31ab9472e6194`. The skill names an explicit
`README.md` argument; the checker also uses a cwd-relative default when no
argument is supplied and ignores additional arguments. The skill reference
alone does not establish all callers or restrict those modes.

The source reads a selected UTF-8 file, scans its text with `re`, prints
findings (which may include input-derived snippets) and a count, and returns a
status. Read or decode errors may propagate. The source review found no direct
subprocess, dynamic evaluation or file write; that observation does not prove
interpreter/import identity or make printed input private-safe.

The existing whole-program registry requires the one fixed entry argument list
`["owned-program", "data-path"]` and has no default-path or cwd condition.
Independent review found no enforcement that excludes the other entry modes.
The registered pivot therefore applies: leave this checker unresolved, with no
complete registry record. A future reviewed schema and caller contract would
need to represent every admitted mode and its data path before re-evaluation.
No source or worker was executed for this review.
