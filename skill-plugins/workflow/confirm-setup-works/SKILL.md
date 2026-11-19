---
name: confirm-setup-works
description: >
  After setting anything up (a token, secret, routine, scheduled job,
  environment variable, or integration), run a real end-to-end check that
  never prints a secret, fix any failure, and only then say it is done. Use
  right after any setup step and before claiming it works. Don't use for code
  changes covered by a test suite (use verification-before-completion).
---

# Confirm setup works

"Set up" is not done until a live check passes.

## Rule

1. After any setup, run a real end-to-end check. Use the setup the way its user will: call the API with the token, trigger the routine once, read the variable from a fresh shell, send one test event through the integration.
2. Never print a secret. Check its presence or length, or the result of a call that uses it. Mask any value in the output.
3. If the check fails, fix the cause and run it again.
4. Only then say it is done. Show the passing check output in the reply.

## Example

A deploy token was saved as a repo secret. The check runs one workflow that uses it and shows `deploy-check: success (HTTP 200)`. The reply quotes that line, never the token.
