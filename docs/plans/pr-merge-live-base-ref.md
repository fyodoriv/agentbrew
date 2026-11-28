# Verify the live destination branch before a merge

**Hypothesis:** A direct reference check catches a destination branch advance
that a passing pull-request check list can miss.

**Measurement:** Run the focused `pr-merge-preflight.test.sh` fixture via
`heavy-run`. Reproduce an open, clean pull request whose passing check list
still refers to the earlier base. Return the later SHA from the direct
destination-branch lookup. Include a matching base and a lost lookup.

**Success:** The advanced-base fixture blocks, the matching-base fixture
continues to pass, and an unavailable lookup fails closed. Both reads
share the existing 5-second network budget.

**Pivot:** If 1 safe merge is blocked or the lookup adds more than 2
seconds in normal use, keep enforcement opt-in and inspect the request
before using it in the default profile.

**Anchor:** [Dotfiles #865](https://github.com/fyodoriv/dotfiles/pull/865)
and its [actual merge parent](https://github.com/fyodoriv/dotfiles/commit/9018448a1c6bacb9cae298d6aff0456f0d2ab79d).

A direct branch read narrows the window between the preflight and the
merge. The merge receipt still needs the actual parent and tree check.
