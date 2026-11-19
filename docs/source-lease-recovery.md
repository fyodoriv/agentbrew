# Source checkout lease needs verification

A busy checkout may still belong to an active refresh. The checkout ID in the
error is the first 12 characters of the corresponding directory name under
`~/.cache/agentbrew/source-checkout-leases/`. More than one matching prefix is
ambiguous; do not assume which checkout it identifies.

Wait for the active refresh to finish, then retry. A missing owner PID alone
does not prove that its Git descendants stopped or that their work is complete.
Keep the lease in place unless you can independently verify the owner and all
related work. If you cannot establish that, leave it in place and seek help.
Do not share the owner record or its token when asking for help.

If the owner releases the directory before a waiting refresh can inspect it,
the refresh retries within its existing time limit. It starts work only after
it creates its own lease. A refresh that does not wait reports the checkout as
busy so you can retry.
