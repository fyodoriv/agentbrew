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
