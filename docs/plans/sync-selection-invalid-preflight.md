# Reject invalid sync selection before startup

The [once-only baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44223422707)
at `043393f5` recorded all four selected cases. Empty API and empty pull
returned 0 after reaching all eight sync modules. Each hit one denied
external action. Unknown plain returned 1 after startup, workspace,
native publication, redaction and two event calls. The selected hooks
case reached shared startup and publication and ran the hooks module.
The two denied actions left the baseline incomplete. The labels refer
to observed imports and do not establish physical writes.

- **Hypothesis**: Validate supplied selection before work in direct
  `update` and before the root sync action hook starts drift checks,
  startup or event recording. Absent selection keeps its default.
- **Measurement**: Use the dedicated fixture with three new named
  regression cases. Capture exit, fixed calls and denied actions for the
  explicit empty API, empty pull and unknown plain forms. Run only
  the new cases. Also run the ordinary CLI, CLI helper and update files.
- **Success**: All three new cases fail on the prior behavior and pass
  with exit 1, zero recorded effects and zero denied actions. Direct
  update rejects invalid input before state or policy reads. The
  existing no-selection, valid selection and event controls pass.
- **Pivot**: Reject any accepted empty value, early effect, changed
  default or valid exit, swallowed operational failure or hidden
  output. Leave the original task open if native output or physical
  writes remain unqualified.
- **Anchor**: The exact merged observation source at `043393f5`,
  the four-case baseline and `sync-selection-preflight`.

Preserve the original result and its denied-action count. This stage
qualifies early refusal through instrumented entry points. Valid selected
publication, shared workspace behavior and real scratch paths need their
own registration before a complete sync-selection fix can be claimed.

## Keep rejected inputs out of diagnostics

Review found that quoting parts of an invalid argument can expose input
fragments when punctuation splits it. Predict the invalid canary appears
in the initial error and zero times after the diagnostic uses fixed text.
It must still exit 1 and list the supported modules. The entire standard
Agentfile, pull and build-health test files must also stay green. Use
production module names with fake handlers in the Agentfile fixture.
Pivot on any input disclosure, dropped hint or valid-path regression.
The red and green tests use a synthetic canary.

## Hosted result

The [pre-fix comparison](https://github.com/fyodoriv/agentbrew/actions/runs/44224138277)
failed all three new guards. The direct update test also rejected the
earlier result for the empty string. The
[diagnostic comparison](https://github.com/fyodoriv/agentbrew/actions/runs/44224757586)
showed the synthetic input in the error and exposed the old fixtures'
assumptions about available modules and events on invalid input.

The [candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44225036095)
passed the three isolated guards with exit 1, zero recorded effects and
zero denied actions. Both direct update cases passed. All 141 ordinary
tests across six files passed, including valid selections, normal
startup and operational-failure events. The independent diagnostic test
confirmed that rejection lists valid modules without printing the input.
Only the newly named cases ran through the dedicated fixture.
