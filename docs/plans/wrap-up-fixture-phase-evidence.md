# Separate wrap-up fixture setup and caller failures

The Nov 15 W03 and W04 reports suppressed the error behind an inconclusive
receipt. W04 took six seconds. That suggests a five-second setup deadline,
but the receipt does not establish which operation stopped.

- **Hypothesis**: A failed receipt names the last fixed phase and a timeout
  or other failure category, with no arguments, paths or error text. A
  caller result cannot become an accepted receipt without the original
  assertions.
- **Measurement**: Run W03 and W04 on hosted CI. In a disposable replay,
  delay a synthetic Git setup operation past five seconds and separately
  delay the product caller past its existing 20-second deadline. Observe
  the two failed receipts without creating artificial machine load.
- **Success**: Both controls report their expected distinct phase and
  deadline category, all healthy controls produce the existing accepted
  receipts, and zero failure details expose local paths or arguments.
- **Pivot**: Any wrong, missing or sensitive classification blocks a
  timing change. A passing replay leaves the original cause unknown.
- **Anchor**: TASKS.md, `wrap-up-fetch-caller-timeout`; Luo et al. 2014.
