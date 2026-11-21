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

The [hosted baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44910206871)
forwarded both shared branch commands and returned exit 0. The linked
checkout, file and previous controls passed. The wrapper checked branch
creation flags but did not look up an existing branch. It now uses a
read-only lookup for the exact local reference and applies the existing
checkout location check.

## Verify the lookup result without resolving an object

- **Hypothesis**: A reference existence check can use local Git metadata
  without resolving an object. A lookup error never forwards the branch
  or file operation.
- **Measurement**: Run the same hosted fixture with a recorder for any
  object-resolving query, 1 injected lookup error and an explicit file
  control under the same error condition.
- **Success**: Each platform records 0 object-resolving queries, 1 refusal
  for the error and 0 forwarded operations for that refusal. The explicit
  file operation and all earlier controls pass.
- **Pivot**: One object query, incomplete lookup that forwards the request
  or changed prior outcome rejects the candidate.
- **Anchor**: [Git reference existence lookup](https://git-scm.com/docs/git-show-ref)
  and the [Git implementation](https://github.com/git/git/blob/v2.43.0/builtin/show-ref.c).

The [hosted lookup baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44910710165)
recorded 6 object-resolving queries on each platform. It also forwarded
the operation after the injected lookup error. The exact reference
existence check now distinguishes an absent reference from a read error.
Git validates the reference name before reading any stored reference.
