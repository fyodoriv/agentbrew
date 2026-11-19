# Page error capture preparation

Issue [#563](https://github.com/fyodoriv/agentbrew/issues/563) remains open.
This package tests a reducer and a bounded WebSocket fixture. No CLI or skill
uses the package. The fixture never opens a browser or reads a browser profile.

## Measurement

Can the reducer retain the seeded errors and refuse incomplete capture?
Can an owned loopback connection supply enough evidence for a synthetic
capture decision? The registered thresholds use observable command replies,
event counts, fixture target lists and cleanup. Keep all 59 reducer controls
and all nine transport families passing. A false clean, lost event,
disclosure or foreign operation rejects the approach. The measurement follows
Basili, Caldiera and Rombach (1994) and Munafò et al. (2017).

```sh
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --manifest-path rust/page-error-probe/Cargo.toml --no-fail-fast --test loopback_transport --test page_error_contracts -- --test-threads=1
```

The sealed reducer controls cover the original P01–P24 decisions and the
supplemental T01–T10 loss, privacy and continuous-traffic cases. The loopback
fixture uses tokio-tungstenite 0.30.0. It uses a connected socket to an owned
ephemeral listener. It bounds the handshake, frame, message, event ledger
and run duration. The paired test tasks end within one invocation.

| Family | Fixture checks |
| --- | --- |
| L01 | Complete clean capture with required acknowledgements |
| L02 | Console, runtime and HTTP errors across two owned sessions |
| L03 | Polling and SSE at cutoff, with and without a seeded error |
| L04 | Failed, missing or mismatched readiness and disconnect |
| L05 | Oversized frames, fragmented messages and event burst |
| L06 | Unknown related-session ownership |
| L07 | Malformed and duplicate event fields and private marker handling |
| L08 | Local cancellation, held socket and mismatched close acknowledgement |
| L09 | Close acknowledgement while the target remains present |

The baseline exercised the loopback handshake and wire events. Its
unqualified decoder reported incomplete for all three positive cases.
The preparation candidate passed nine transport families and all 59
retained reducer controls in a private checkout. The cancellation control
uses a local test signal. The cutoff and target list come from the fixture.

## Remaining proof

Stock browser polling lacks the event coverage and loss reporting needed
for a complete result. The disposable browser still needs qualified
admission and an isolated network boundary. Then a real fixture must
prove coverage of its page, frame and worker, preserve a separate sentinel,
and confirm removal of the exact leased target.

A real fixture can prove its own cutoff through independently seeded
events. It cannot prove a general drain for every Chrome session. The
production adapter must remain incomplete until it can prove its capture
window and scope. The skill, CLI registration, and real browser evidence
are outside this preparation.

## Native network admission experiment

Question: can a disposable Darwin process reach only its assigned local
fixture endpoint? Measure two synthetic loopback TCP listeners on different
ports. The isolated client must connect to the allowlisted endpoint and
receive its exact marker. The denied listener must receive no connection,
and the client must report a permission refusal for it. Run the same client
without a profile as a positive control for both listeners. That control
must reach both and receive their distinct markers.

Keep the sandbox candidate only at one allowed connection, zero denied
connections, and two positive-control connections. Reject it if either
listener cannot be independently observed or the refused connection looks
like a missing listener. This is a transport admission probe. It does not
qualify Chrome, target ownership, cleanup, or any live page result.
Measurement framing: Basili, Caldiera and Rombach (1994), Goal Question Metric.

For the browser follow-up, run the private Playwright admission harness
with `heavy-run node "$PAGE_ERROR_ADMISSION_PROBE"`. Both Chrome launches
deny outbound network by default and use fresh profiles and the test keychain
flags. The positive control allows both listener ports. The candidate allows
only the first. Keep the candidate only if the page receives both markers in
the control, then only the first marker in the candidate. The second listener
must receive zero marker requests and CDP must report access denied for that
request. Any failed positive control, timeout in place of refusal, or unexpected
connection rejects the candidate.

The disposable Chrome control reached both loopback markers once. The
restricted profile reached the allowed marker once and the denied marker
zero times. CDP reported `net::ERR_ACCESS_DENIED` for the denied request.

The first two launches stopped before navigation because Chromium could
not bind its profile singleton socket. A standalone Unix socket probe
reproduced the refusal with the unresolved temporary path and succeeded
with the resolved path. The final profile allowed only a local bind at
Chromium's singleton socket under that resolved directory. The TCP allow
list stayed the same.

This qualifies loopback admission for the disposable browser. The
owned-target capture window, event completeness, and cleanup still need
browser evidence.

## Owned-target capture experiment

Can the capture observe each seeded error and close only its leased tab?
Run the disposable Chrome fixture with
`heavy-run node "$PAGE_ERROR_CAPTURE_PROBE"`. Use the Chrome debugging
pipe and the same deny-by-default network profile. Give the fixture one
allowed loopback HTTP port and keep the browser profile disposable.

Create two tabs in one disposable browser context. Lease one by its target
ID and keep the other as a sentinel. Enable Runtime and Network on the
leased session before navigation. Attach to related targets with a startup
pause. Enable their domains before resuming them. Seed console errors and
runtime exceptions in the main page, frame, and worker, plus one HTTP
failure from the main page. The fixture must confirm all seven events were
emitted before it checks capture. Use a distinct sentinel marker to prove
its traffic stays outside the report.

Keep the approach only with seven of seven captured events, zero sentinel
events, and a target list that confirms the exact leased ID disappeared
while the sentinel remained. Reject it on any missed event, unexpected
target, unconfirmed close, or missed fixture deadline. The fixture cutoff
comes from these independently seeded events. It cannot qualify a general
browser drain. Measurement framing: Basili, Caldiera and Rombach (1994),
Goal Question Metric. [Chrome DevTools Protocol Target domain](https://chromedevtools.github.io/devtools-protocol/tot/Target/).

The disposable fixture received all four independent emission receipts.
Capture observed the six named console and exception events across the
page, frame, and worker, plus the expected HTTP 503 response. The sentinel
console event was observed on its separate session and absent from the
leased-session report. After close, target discovery confirmed the leased
ID was absent and the sentinel ID remained.

The direct Chrome launch first failed to initialize its nested sandbox.
The successful run used the same Chromium sandbox setting as Playwright's
default launch under the outer Darwin profile. Both runs used disposable
profiles, test keychain flags, the debugging pipe, and synthetic local
pages. This fixture result leaves production capture integration and
general event-drain coverage open.

## Native trace completion experiment

Can Chrome's trace flush qualify capture of console, exception, and request
failures? On one disposable Chrome instance, start a trace and subscribe to
Runtime and Network events before opening the loopback fixture. The fixture
must log one console error, raise one uncaught exception, and receive one
HTTP 503 response. The independent Runtime and Network events must report
all three. The local server must observe exactly one request for the failing
resource.

Run the private fixture with `heavy-run node "$PAGE_TRACE_PROBE"`. Bound
the run to 30 seconds. Allow network access to the fixture port only. Use
fresh browser state and the test keychain flags. Record only counts and the
trace completion flag. Keep the trace candidate only if the trace reports
each of the three failures in a structured event and reports no trace loss.
Use the request ID to match a received response to the exact fixture path.
If a direct control fails, the run is inconclusive. If the controls pass
and the trace misses a failure, keep production closure unverified and
reject that trace configuration as the event source.
Anchor: [Chrome Tracing completion](https://chromedevtools.github.io/devtools-protocol/tot/Tracing/#event-tracingComplete),
issue #563, and Basili, Caldiera and Rombach (1994).

Chromium 149.0.7827.55 reported trace completion with no reported trace
loss or fixture overflow. The trace matched the failing resource by its
request ID and HTTP 503 status. It contained neither of the two synthetic
error markers. The direct Runtime and Network controls observed all three
failures on the same page. The allowed server saw one request for the
resource. The denied server saw zero requests, and the browser reported
access denied. The fixture closed the context and browser.

The trace used `devtools.timeline`, `disabled-by-default-devtools.timeline`,
`blink.console` and `v8`. This result rejects that configuration as an
event source for the complete gate. The trace completion flag covers the
trace buffer. Production capture still needs a verified cutoff for each
owned Runtime and Network session.

## Loopback close acknowledgement

The local nine-family fixture run failed in L08 at the peer's flush with
`BrokenPipe`. The client can finish its close write and drop the socket before
the peer returns its close frame. The pinned tokio-tungstenite close sink
drives the write. The stream reads the reply.

Hold the peer reply until a test-owned barrier releases it. Predict one
premature client return on the unchanged fixture and zero after the client
waits for the reply. Run the new case by name, then the existing loopback
and reducer suite with the command above. Keep zero failures in the held
reply case, all nine existing families, and all 59 reducer cases. Reject
any change to capture decisions, target cleanup checks or existing
deadlines. Anchor: L08 terminal result and tokio-tungstenite 0.30.0
`poll_close` and `poll_next`.

The held reply control reproduced premature return. The first fix passed
that control. L08 then exposed a second issue: the cancelled client's
in-flight Runtime reply shifted the target cleanup replies by one frame.
The first frame at WebSocket shutdown was the target-list reply, with
request ID 9. The pinned inherent `WebSocketStream::close` sends the local
close frame. A stream read is still needed to observe the peer reply.

For the cancellation case, admit at most one exact, outstanding Runtime
reply before the target close acknowledgement. Predict zero false cleanup
refusals for cancellation and zero false approvals of the mismatched
target reply. Check the existing L08 result, one explicit cleanup receipt
after cancellation, and the held close case. Reject any other skipped
reply or change to the capture exit, time limit or owned target checks.
