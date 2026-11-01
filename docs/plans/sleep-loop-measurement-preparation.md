# Sleep-loop measurement preparation

## Hypothesis

Goal: make the existing event-wait experiment measurable without retaining
commands. Question: can the recorder label the existing hint's syntactic
until/while-plus-sleep signal and report its evidence coverage honestly?
Metric: nine classifier controls produce exactly their expected enum labels;
seven report controls preserve correlation and missing-data limits. Private
fixture arguments and paths occur zero times in emitted rows or reports.

This preparation does not predict a speed improvement or establish that
observed syntax causes polling. It does not expand the hint to for loops.

## Measurement

`npx vitest run src/scripts/sleep-loop-measurement.test.ts`

Classifier controls: explicit foreground; explicit background; absent mode;
for-loop outside scope; quoted text; comment text; heredoc data; missing
command; quoted shell-script argument outside the heuristic's scope.

Report controls: paired timed foreground; paired timed background; paired
timed unknown mode; missing call id; missing duration; absent matching
attempt; historical rows without metadata. Assert exact counts, recorded
whole-call durations and outcomes, unchanged historical log bytes, and no
inferred timeout cause or background worker runtime. Scope metadata to each
tool call; persist only fixed enums alongside existing ids/durations/outcomes.

## Success

Nine of nine classifier controls and seven of seven report controls pass;
zero raw private values leak; all missing-evidence controls remain unknown.
Existing recorder/hint/report fixtures pass and the final combined full gate
exits zero. A new seven-day cohort starts only after installed source is
verified and a dated cutover is recorded. Earlier rows remain historical.

## Pivot

Abandon the classifier if any of the sixteen controls is wrong, any raw
private value leaks, or any unavailable evidence becomes a causal claim.
Retain a coverage-and-unknown diagnostic if the available payload cannot
support trustworthy syntax labels. Do not alter the original outcome's
speed or timeout thresholds based on these fixture results.

## Anchor

Basili, Caldiera, and Rombach (1994), Goal Question Metric; Munafò et al.
(2017), pre-registration; Forsgren, Humble, and Kim (2018), measurement of
delivery outcomes. Coverage is an instrumentation gate, not outcome success.
