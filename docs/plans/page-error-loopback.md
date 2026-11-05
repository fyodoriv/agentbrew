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
