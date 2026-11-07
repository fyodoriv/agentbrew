# Separate chat schema runner: synthetic preparation

The original baseline failed and its empty reservation remains closed. The new
case-selection plan and private case hash were committed separately before any
new model call. This plan authorizes fake-transport preparation only. It does
not authorize an inference, a candidate rule or a new live baseline.

Goal: bind a distinct one-shot comparison to its evidence. Question: can a
runner reserve, finalize and compare synthetic decisions without retrying or
accepting changed inputs? Predict 13/13 named fake controls pass, with zero
unsafe requests, raw-response disclosure or false finalization. Any failure
of those conditions rejects this runner approach. Four valid responses alone
would not prove decision quality.

The future runner uses the existing `scripts/chat-rule-schema-protocol.mjs`
through an injected transport. Do not modify or invoke the original baseline
implementation. Bind exact case bytes and order, schema bytes, prompt template,
model name and digest, runner bytes, temperature and receipt schema. The
registered private case artifact is 1,301 bytes with SHA-256
`aa1bc50cdd81444386553893121d6a678a37ce4e6a6e1aa265c755cb51d7c1ca`.
The currently observed local `qwen3:4b` digest is
`359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7`;
it must be rechecked and separately bound before any later live admission.
No inference was made to obtain that metadata.

The frozen base prompt template is the literal prefix `You are choosing how
to add a follow-up in a chat. `, then the sole rule insertion (empty for the
baseline), then a newline, the case's `text`, another newline, and the literal
suffix `Choose exactly one action: EDIT, POST, or HOLD.`. Bind the UTF-8
template and insertion bytes separately; case labels are never put in a prompt.

Read a case file through a no-follow descriptor, check regular-file type,
owner, private mode, link count, size and expected hash, and recheck descriptor
identity after reading. Use the retained verified bytes without reopening them.
Reject missing or changed case, schema, runner or base-template bytes before
any metadata or inference request. A private receipt is exclusively reserved
before requests; it and its marker must be regular private no-follow files.
Write and fsync the complete receipt, write and fsync private marker bytes,
then publish that marker exclusively and atomically. Validate marker bytes and
the receipt hash before candidate use. An existing, interrupted, malformed,
mismatched or orphaned path is never overwritten or retried. Sync or marker
publication errors fail closed. This is a process-interruption contract, not a
power-loss durability claim. Do not remove the original reservation.
Filesystem exclusivity prevents reacquisition at that reserved path. A
different path cannot authorize a second admission under this experiment;
that is an experiment rule, not a global filesystem guarantee.

Candidate comparison first independently validates the baseline receipt hash
and marker. It binds all shared case, model, schema, base-template, options and
runner identities. Exactly one separately registered candidate-rule byte
sequence and hash may be inserted into the frozen base template. Any other
mismatch refuses before metadata or inference. Log only fixed errors and
aggregate counts; never print raw model responses or case text.

Commit this prediction before adding code. The first named test uses an
explicit placeholder and must fail with `schema runner unimplemented`:

```sh
bash <<'BASH'
log=$(mktemp) || exit 2
trap 'rm -f "$log"' EXIT
heavy-run node --test --test-reporter=tap --test-name-pattern='^valid baseline finalizes$' scripts/chat-schema-runner.test.mjs >"$log" 2>&1
status=$?
[ "$status" -ne 0 ] && grep -Fxq 'not ok 1 - valid baseline finalizes' "$log" && grep -Fq 'schema runner unimplemented' "$log" && grep -Fxq '# fail 1' "$log" && grep -Fxq '# pass 0' "$log"
BASH
```

The thirteen ordered tests in `scripts/chat-schema-runner.test.mjs` use private
scratch files and fake transport. Counts below are inference requests; model
metadata probes are fake and counted separately. An admitted baseline or
candidate makes exactly two metadata probes, before and after its four
inferences. Refusals before admission make zero of either kind.

1. `valid baseline finalizes`: four responses, two metadata probes and one
   complete final marker.
2. `valid candidate compares`: four candidate responses against a prebuilt
   synthetic finalized baseline; two metadata probes; preserve bindings.
3. `existing reservation refuses`: zero inference requests.
4. `orphan marker refuses`: zero inference requests.
5. `interrupted reservation refuses retry`: an injected barrier stops after
   reservation and before metadata. Prove a candidate starts during that
   unfinalized window and makes zero metadata or inference requests. Then
   interrupt the baseline; the attempt remains reserved and same-path retry
   makes zero metadata or inference requests.
6. `concurrent admission single`: an explicit barrier holds the first owner
   after reservation until the second refuses. Exactly one admission, two
   metadata probes and four inferences occur.
7. `case hash mismatch refuses`: zero metadata and inference requests.
8. `unsafe case path refuses`: symlink, owner/mode and link-count controls,
   each with zero inference requests.
9. `digest drift refuses finalization`: four responses, two metadata probes,
   no final marker.
10. `malformed response stays private`: one inference after one metadata probe,
    fixed error and no raw response marker in any captured output.
11. `failed finalization refuses candidate`: separately inject receipt-sync
    and marker-publication failures after four responses and two metadata
    probes; prove each injection fired, the reservation remains unchanged and
    unusable, and candidate and same-path reacquisition make zero requests.
12. `candidate binding mismatch refuses`: altered case, model, schema,
    base-template or runner identity each makes zero metadata and inference
    requests, as do missing, malformed, mismatched or orphan markers.
13. `no improvement rejects`: two independent fake candidate subcases each
    make four inferences and two metadata probes against the synthetic
    baseline. Equal score and improved-but-imperfect 3/4 are both refused.

For scoring controls use synthetic expected choices `EDIT, POST, POST, HOLD`.
The prebuilt baseline answers are `POST, POST, EDIT, HOLD` (2/4); the valid
candidate answers match all four (4/4). The no-improvement case returns the
baseline answers (2/4); the improved-but-imperfect case returns `EDIT, POST,
EDIT, HOLD` (3/4). These are fake fixtures, not the sealed case artifact.
Barriers are in-process injected promises with bounded deadlines; no child is
launched, so there is no child cleanup to infer.

Canary the fake transport and each stdout, stderr, console and thrown-error
channel with a synthetic marker. Before importing the runner, install and
canary fail-closed sentinels for `child_process.execFileSync`, `spawn`,
`spawnSync`, `execFile`, global fetch, `net.connect`, `createConnection`,
`Socket.prototype.connect`, and HTTP/HTTPS `request` and `get`. Reset counts
after the canaries and require zero actual process, network or model calls.
Inspect the tested source for alternate launch paths.
All paths and responses in these controls are synthetic. Before and after the
suite, verify the old receipt remains zero bytes with SHA-256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`; do
not publish its contents. The tests must not read the frozen real case file.

After implementation run the thirteen controls with an exact TAP oracle:

```sh
bash <<'BASH'
set -o pipefail
log=$(mktemp) || exit 2
check_old() {
  old=/tmp/chat-rule-821-baseline.json
  [ -f "$old" ] && [ ! -L "$old" ] && [ "$(stat -f '%Lp:%z' "$old")" = '600:0' ] && [ "$(shasum -a 256 "$old" | awk '{print $1}')" = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' ]
}
finish() {
  status=$?
  trap - EXIT
  if ! check_old; then printf 'old reservation changed\n' >&2; status=2; fi
  rm -f "$log"
  exit "$status"
}
trap finish EXIT
check_old || exit 2
JOBS=1 heavy-run node --test --test-reporter=tap scripts/chat-schema-runner.test.mjs 2>&1 | tee "$log" || exit 1
grep -Fxq '1..13' "$log" || exit 2
names=('valid baseline finalizes' 'valid candidate compares' 'existing reservation refuses' 'orphan marker refuses' 'interrupted reservation refuses retry' 'concurrent admission single' 'case hash mismatch refuses' 'unsafe case path refuses' 'digest drift refuses finalization' 'malformed response stays private' 'failed finalization refuses candidate' 'candidate binding mismatch refuses' 'no improvement rejects')
for i in "${!names[@]}"; do [ "$(grep -Fxc "ok $((i + 1)) - ${names[$i]}" "$log")" -eq 1 ] || exit 2; done
[ "$(grep -Ec '^(not )?ok [0-9]+ - ' "$log")" -eq 13 ] || exit 2
for line in '1..13' '# tests 13' '# pass 13' '# fail 0' '# cancelled 0' '# skipped 0' '# todo 0'; do [ "$(grep -Fxc "$line" "$log")" -eq 1 ] || exit 2; done
for pattern in '^1\.\.[0-9]+$' '^# tests [0-9]+$' '^# pass [0-9]+$' '^# fail [0-9]+$' '^# cancelled [0-9]+$' '^# skipped [0-9]+$' '^# todo [0-9]+$'; do [ "$(grep -Ec "$pattern" "$log")" -eq 1 ] || exit 2; done
check_old || exit 2
BASH
```

Success requires all thirteen named controls, no unsafe request or disclosure,
the prior schema/receipt controls unchanged, independent review and the
ordinary final gate. Missing controls, altered bindings, retry after a consumed
reservation or any disclosure reject this approach. Register gate discovery
before changing the local gate. After this preparation lands, separately
register an exact live baseline command, current model digest, source hashes,
receipt path and numeric thresholds before a single admission. Preserve the
four-case limits and the explicit 4/4-baseline pivot in the case-selection
plan; do not select a new case set after an outcome.

Anchors: #850's fake-only schema protocol and the original receipt controls;
Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò et al. (2017),
preregistration. No real chat or message operation is authorized.
