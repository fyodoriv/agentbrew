# Plugin-update guidance experiment

## Hypothesis

Goal: an update tells the user how to choose the installed name and tag and
when a separate skill source can hide the updated plugin. Question: do the
three reported guidance gaps remain? Metric: missing-argument help, unknown-name
suggestion and duplicate-source warning regressions pass (zero gaps).

## Measurement

`npx vitest run src/plugins/cli-plugin.test.ts src/plugins/update-guidance.test.ts`
then the required `npm run verify` gate.

## Success

All regression cases pass and the required gate exits 0. Plugin skill content
comes from the locked checkout; separate user-owned sources are warned about,
never fast-forwarded without their ownership and selection being resolved.

## Pivot

If duplicate detection cannot establish selected source precedence, report
that uncertainty instead of changing another owner's checkout. Remote tag
lookup is read-only, time-bounded and labels tags unverified; it never installs
a ref without existing signature and capability checks.

## Anchor

Basili et al. (1994), Goal Question Metric; issue #664 reports three concrete
failure paths. Signed plugin install and capability gates remain unchanged.
