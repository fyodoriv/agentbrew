# Correctness

Hunt logic bugs: code that builds and passes its tests but does the wrong
thing. For each item, read the changed lines and the code that calls them.

- **Wrong conditions**: an inverted or off-by-one check (`<` for `<=`), `&&`
  for `||`, a negated early return, a missing `else` or `default` branch.
- **Falsy defaults**: `x || fallback` or `if (!x)` where `0`, `""`, `false`,
  or an empty list is a valid value. Look for `??` or an explicit
  missing-value check.
- **Missing data**: an optional field read without a check, an empty list
  treated as "not loaded", a missing key that turns into `undefined` or
  `None` in a string, a path, or a URL.
- **Async races**: a missing `await`, a promise nobody handles, two writers
  on the same state, a gap between a check and the act, a stale closure, a
  retry that runs a side effect twice.
- **Producer/consumer drift**: a field renamed, retyped, or made optional on
  one side only: API and client, event and handler, schema and query, CLI
  flag and docs, config key and reader.
- **Flag gates**: new code that runs when its flag is off, an old path that
  the flag no longer reaches, a flag default that differs between
  environments, a cleanup that removes the flag but not its dead branch.
- **Error paths**: a swallowed error, a catch that returns success, cleanup
  that does not run on failure, a partial write left behind.
- **Boundaries**: time zones and date math, units, text encoding, number
  overflow, pagination that drops the last page, an empty or single-item
  input.
- **Tests that do not test the change**: a test that still passes with the
  change reverted, a mock that returns the expected answer, an assertion on
  the mock instead of the result, a snapshot updated without a look, a
  skipped or focused test.

For each finding, name the input or state that triggers it, the code path
(`file:line`), and the wrong result. The verify pass checks exactly that.
