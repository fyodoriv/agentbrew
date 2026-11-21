# Keep named branch switches out of shared checkouts

The Git session wrapper already checks branch creation and whole-tree
operations. This phase covers a direct switch to an existing local
branch whose name contains a slash.

- **Hypothesis**: The session wrapper refuses a direct checkout or
  switch to a verified namespaced local branch in a shared checkout.
  It preserves linked checkout use and explicit or unambiguous file use.
- **Measurement**: Run hosted `bash hooks/checks/git-script-guard.test.sh`.
  Use the installed opt-in layout and the existing argument recorder.
  Make the read-only reference and checkout probes distinguish the
  named local branch, an ordinary file and a linked checkout.
- **Success**: Both shared branch commands return exit 2 with 0
  recorded Git mutation calls. Both linked operations and both file
  controls preserve their argument list. The previous Git guard cases
  and the real read-only comparison pass.
- **Pivot**: One shared operation reaches Git, one linked or file
  control refuses, or one original control changes.
- **Anchor**: The shared-checkout case in `block-remaining-dangerous-commands`,
  the existing Git wrapper and [Git checkout](https://git-scm.com/docs/git-checkout#_argument_disambiguation).

This phase checks the direct local-branch form. It leaves ordinary Git
path parsing and remote branch guessing with Git.
