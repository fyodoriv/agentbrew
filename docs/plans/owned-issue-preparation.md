# Prepare owned issues without routine owner questions

The open issues specify the desired behavior. Storage ownership, source
recovery, and adapter selection can proceed as agent work. This document
changes preparation routing only. No implementation or measurement passes
are claimed. Existing task success and pivot criteria remain binding.

## Checkup records — issue 572

Keep one generic record owner in agentbrew. Expose `checkup-run show|record`
with the issue's per-user path and `finished_at`, `result`, and `commits`
fields. Validate names, records, and output ownership. Replace a completed
record atomically; an interrupted run must preserve the previous record.

Dotfiles already owns a richer checkup snapshot and history. Adapt it to the
generic boundary without replacing its private history or probing tools just
to save a record. First deliver runnable instrumentation for two checkup runs,
first-run behavior, interruption, invalid input, and unsafe output targets.
The second run must show the first run's time and commits. Do not infer a
baseline from the absence of a command.

## Google Docs capture — issue 561

Extend `markdown-for-gdoc`. Dotfiles' existing `agent-tab` owns background
tabs and leases and supports DOM evaluation and screenshots. Wrap the owner
CLI instead of copying its transport. Make any dependency explicit: an
agentbrew-only installation need not have dotfiles.

Before implementation, register a ten-page synthetic fixture. Measure page
progression, distinct captures, forbidden keyboard/activation calls and tab
cleanup on success, timeout, cancellation and capture failure. State belongs
to one capture run and its owned tab. Never edit document content or close
another run's tab. Retain the task's real ten-page Google Doc and zero-focus-
change acceptance. Synthetic output alone cannot prove that outcome. Inspect
available authorized sessions before declaring authentication blocked.

## Page error gate — issue 563

Public commit `43465de` removed the deleted `fyodoriv/page-zero-errors`
recommendation. A bounded search of public refs, registered source cache,
and canonical local repositories did not recover its implementation. This
does not prove that no copy exists elsewhere. Do not search private archives
or claim absorption of unrecovered source.

Reuse maintained browser transport. Agentbrew's existing Playwright
dependency and screenshot orchestration provide local reuse candidates.
Register clean and error fixtures before implementation. Capture must start
before navigation and include console errors, runtime exceptions, 404 and
5xx responses. A clean result requires complete capture. Keep blocked SSO or
incomplete capture distinct from success. Hosts are settings, never built-in
organization names. State belongs to one capture run and its owned tab.

## History leak audit — issue 564

Extend the existing plugin leak-audit owner. The current scanner covers
tracked files only. Dotfiles' push guard covers a pushed range; it does not
already satisfy the requested all-ref audit.

Gitleaks is installed in the verified development environment. This is not
an install permission for other environments. Report a missing scanner as a
missing prerequisite. Use a fixed trusted config, explicit empty ignore file,
redaction and bounded execution on a private bare mirror. Repository-local
configuration and allow comments must not weaken the audit. Cover ref names,
paths, emails, commit/tag messages and added content. Never report matched
private text. The mirror and sanitized receipt belong to one audit run.

Register seeded fixtures for each surface and an adversarial local ignore
configuration before implementation. Keep the task's five-of-five criterion;
additional controls must not replace or weaken it. No public release is
authorized merely because an audit passes.

## Delivery

Use the measured Rust migration plan for new native boundaries and shared
measurement work. Keep unrelated runtime ports out of these issues. Register
exact runnable commands and numeric thresholds before candidate changes.
Current acceptance remains incomplete until its actual evidence exists.

This routing-only change uses the existing changed-files gate as its metric.
It adds no runtime behavior and makes no performance claim.
