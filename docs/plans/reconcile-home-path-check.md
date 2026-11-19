# Reuse the home path check

The Minsky migration queued another check for literal user home paths.
Agentbrew's existing public-release check covers Markdown, shell and
JavaScript or TypeScript. It runs in the pre-push hook.

- **Hypothesis:** The existing check covers the queued scope with no second
  scanner. It reports one planted path in tracked code and one in tracked
  Markdown, and accepts portable spellings and the tracked Agentbrew tree.
- **Measurement:** Call the exact base revision's `scanPublicFiles` on a
  disposable repository containing two planted paths and two portable
  controls. Call it again on the tracked base tree at `015e888e`.
  Verify that `lefthook.yml` calls `npm run check:oss` and that its existing
  suite calls the same scanner.
- **Success:** Exactly two findings in the planted fixture and zero
  findings in both the portable-only fixture and the real tracked tree.
  Keep the existing pre-push command.
- **Pivot:** One missed planted case or one actionable false positive keeps
  the task open. Reuse and correct the existing scope before adding a gate.
- **Anchor:** Agentbrew #1134, `src/oss/public-release-privacy.ts`, and
  OWASP 2021 A01, information exposure.

On November 19, the scanner reported both planted paths and no findings in
the portable fixture or the tracked base plus this registration. The
pre-push hook and the existing OSS suite called the expected scan path.
Reuse that gate for the queued home-path check.
