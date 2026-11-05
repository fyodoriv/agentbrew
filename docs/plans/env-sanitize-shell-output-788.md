# Shell-safe environment cleanup — issue 788

Registered before regression execution or production edits.

Goal: let a shell consume `agentbrew env sanitize` without executing human
status text. Question: can its complete CLI output remain shell code only
while ordinary human commands retain their banner?

Hypothesis: both registered clean/set environment CLI controls currently
contaminate stdout when initialized state exists. The candidate reduces
those failures to zero by routing this exact command's human messages to
stderr. A cached upgrade notice must obey the same boundary.

Measurement:

```sh
heavy-run npx vitest run src/env-sanitize-cli.test.ts src/motd.test.ts src/auto-upgrade.test.ts src/core/env-sanitize.test.ts src/commands/cli-env.test.ts
```

The new CLI fixture invokes the real source entry point in a child process
with scratch HOME, safe synthetic state and an explicit environment. It
checks exact empty/unset stdout, repair and upgrade diagnostics on stderr,
and the normal `env check` banner on stdout. A separate child shell consumes
the command substitution and proves selected variables are unset without
shell errors. No emitted shell runs in the owner process. Upgrade metadata
and npm responses are fixtures; no registry access or installation is allowed.

Success: every control passes, zero non-shell stdout lines on sanitize,
zero child-shell errors, zero emitted fixture values, and the ordinary
command banner remains visible on its existing stream. Pivot: reject any
contamination, shell error, lost ordinary banner or real external action.
Baseline setup errors do not count as a behavioral reproduction.

Scope: canonical command dispatch, MOTD output and its upgrade diagnostics.
Do not globally move banners or match raw argument substrings. The output
sink belongs to each invocation; existing defaults remain unchanged.

Anchor: POSIX shell command substitution substitutes standard output into
the shell command, https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html#tag_19_06_03;
Basili et al. (1994), Goal Question Metric; Munafò et al. (2017), preregistration.

Estimate: 30–60 minutes for reproduction, narrow fix and review, plus the
normal shared queue and required verification gate. Keep this estimate
separate from measured command duration.
