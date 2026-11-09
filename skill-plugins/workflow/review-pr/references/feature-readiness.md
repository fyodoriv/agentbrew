# Feature readiness before a review ask

Before saying a PR is ready or drafting a review ask, send a fresh independent
judge the PR head, stated features, and running app or deployed preview. Do
not give the judge the author's reasoning. It runs each feature for real.
For UI work, check every panel and component under every value of each input,
filter, and dropdown. Capture each state and inspect the screenshot. A control
that changes nothing visible fails unless its specified behavior explains it.

Collapsible sections are expanded by default. The functional judge returns FAIL for a section collapsed without a real reason, such as a very long raw log or large data dump.

The judge returns PASS or FAIL per feature, with the screenshot or transcript
for each result. Fix every FAIL, then judge the changed feature and any affected
feature again at the new head. Hold the ready claim and review ask until all
features pass. The draft judge also checks that PASS list.

When the optional human-review-blockers rule is enabled, prepare a Human check
list, app URL, any version override, steps and screenshots. Leave every human
box unticked until the user confirms in chat. Do not claim an AI check is a
human check. Keep each unresolved manual check as an explicit blocker and
continue independent work.

When judge-operator-audience is enabled, show the proof page to the user before
saving any results draft for other people. The user approves the proof, then
each audience step in the agreed order. This does not replace posting approval.
