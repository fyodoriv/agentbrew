# Sleep-loop measurement preparation

## Hypothesis

Goal: make the existing event-wait experiment measurable without retaining
commands. Question: can the recorder label the existing hint's syntactic
until/while-plus-sleep signal and report its evidence coverage honestly?
Metric: ten classifier controls produce exactly their expected enum labels;
eight report controls preserve correlation and missing-data limits. Private
fixture arguments and paths occur zero times in emitted rows or reports.

This preparation does not predict a speed improvement or establish that
observed syntax causes polling. It does not expand the hint to for loops.

## Measurement

`npx vitest run src/scripts/sleep-loop-measurement.test.ts`

Classifier controls: explicit foreground; explicit background; absent mode;
for with sleep; for without sleep; quoted text; comment text; heredoc data;
missing command; quoted shell-script argument outside the heuristic's scope.

Report controls: paired timed foreground; paired timed background; paired
timed unknown mode; paired timed for-with-sleep; missing call id; missing
duration; absent matching attempt; historical rows without metadata. Assert exact counts, recorded
whole-call durations and outcomes, unchanged historical log bytes, and no
inferred timeout cause or background worker runtime. Scope metadata to each
tool call; persist only fixed enums alongside existing ids/durations/outcomes.

## Success

Ten of ten classifier controls and eight of eight report controls pass;
zero raw private values leak; all missing-evidence controls remain unknown.
Existing recorder/hint/report fixtures pass and the final combined full gate
exits zero. A new seven-day cohort starts only after installed source is
verified and a dated cutover is recorded. Earlier rows remain historical.

## Pivot

Abandon the classifier if any of the eighteen controls is wrong, any raw
private value leaks, or any unavailable evidence becomes a causal claim.
Retain a coverage-and-unknown diagnostic if the available payload cannot
support trustworthy syntax labels. Do not alter the original outcome's
speed or timeout thresholds based on these fixture results.

## Anchor

Basili, Caldiera, and Rombach (1994), Goal Question Metric; Munafò et al.
(2017), pre-registration; Forsgren, Humble, and Kim (2018), measurement of
delivery outcomes. Coverage is an instrumentation gate, not outcome success.

## Pre-test schema refinement

Before any new fixture or implementation ran, independent schema review
identified that the known migrated category uses for/status/sleep. Record
`for-sleep-v1` separately as a positive syntactic signal, without expanding
the hint's until/while scope. The extra classifier and report controls above
cover it. Separate metadata tagging, timed correlation and observed syntax
counts; none measures actual behavior coverage, which remains unknown.
