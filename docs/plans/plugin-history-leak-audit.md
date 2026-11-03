# Issue 564 history audit fixture registration

Synthetic-only prediction. Results are pending. Commit this registration before creating fixtures. The existing changed-files gate measures this docs-only change. The open issue, TASKS.md task plugin-history-leak-audit and docs/plans/owned-issue-preparation.md own scope.

Extend the existing plugin leak-audit owner in src/plugins/leak-audit.ts and its command in src/plugins/cli-plugin.ts. Preserve tracked-only defaults. Proposed opt-in flags are --history, --patterns-env <file> and --fresh (implies history). Keep existing action discovery and exit meanings 0 clean, 1 findings or policy rejection, 2 incomplete. Use Git plumbing and Gitleaks. The unpublished Rust inventory has no qualified all-ref audit boundary and still has transport blockers.

Use a private local-source bare mirror with clone --mirror --no-local, no shared alternates, no checkout and no remote fetch. Compare sealed source/mirror ref and object identity. Reject observed drift, shallow/missing objects, unsupported ref targets and traversal errors. Scope covers local refs including custom namespaces. Enumerate names, raw commit identities/messages, annotated tag messages and historical paths with bounded Git plumbing. Check root and all parent comparisons including merge-only additions.

Parse the trusted env file as data. Proposed variable is OSS_READINESS_INTERNAL_PATTERN. Reject missing, empty, unsupported or invalid expressions. Never source the file. Qualify equivalent regex semantics before claiming existing env format compatibility. Keep tracked-only plugin pattern behavior unchanged.

Use Gitleaks 8.30.1 with bounded stdin for calibration. Record its executable digest and report a missing prerequisite. Do not install it implicitly.

Use fixed trusted config without default inheritance, explicit empty ignore file, --ignore-gitleaks-allow, --redact=100, --no-banner and a bounded timeout. Scrub inherited Git/scanner overrides, network, credentials, external diff and text conversion. Raw reports/stderr stay inside scratch. External results have only fixed surface IDs/counts. Invocation owns the mirror, config, child, result and cleanup. Fresh requires exactly one reachable parentless commit, exactly refs/heads/main, and symbolic HEAD on main. Audit never writes the source.

## Goal, question and metric

Can the old tracked gate miss historical leaks which the candidate finds on the correct surfaces? Predict 0/5 old and 5/5 candidate. For each old row use the actual existing command and a synthetic active installed pattern so the old audit really runs and reports clean. An unsupported new flag is a compatibility observation, not semantic evidence. Candidate invocations use the actual handler. Each member gets an independent marker and result so one subtype cannot mask another. Keep the final main tree free of all five seeded marker groups.

```sh
JOBS=1 heavy-run npx vitest run --maxWorkers=1 \
  src/plugins/leak-audit-history.test.ts src/plugins/leak-audit.test.ts
agentbrew plugin leak-audit --cwd "$fixture_repo" --history --patterns-env "$fixture_env"
agentbrew plugin leak-audit --cwd "$fixture_repo" --fresh --patterns-env "$fixture_env"
```

The last two lines describe handler invocations inside the fixture runner. Use isolated scratch HOME/Git config and fixed synthetic inputs. Freeze generated seed/expectation receipts before measuring. Existing focused tests must pass unchanged.

| ID | Required outcome |
|---|---|
| S01 | Author and separate committer email markers each found. |
| S02 | Commit and annotated tag message markers each found. |
| S03 | Branch and tag ref name markers each found, with independent custom-ref traversal. |
| S04 | Removed historical path marker found without printing the path. |
| S05 | Removed added-line marker found, with independent root and merge-only additions. |
| C01 | Clean complete history exits 0. |
| C02 | Retained tracked audit tests pass. |
| C03 | Local config, matching ignore fingerprint and inline allow each fail to suppress a match. |
| C04 | Valid fresh passes. Extra branch, tag, custom ref and second commit each fail fresh. |
| C05 | Missing scanner, invalid or empty env, missing object, excess input and forced timeout each exit 2. |
| C06 | Zero raw marker, path, ref, pattern or stderr leakage. Source bytes unchanged. Scratch removed on success and error. |
| C07 | Git helper, credential and remote canaries record zero executions. Inherited scanner config has zero effect. |
| C08 | Replace refs, shallow history and unsupported ref topology cannot produce a false clean. |

Success is 5/5 surface groups, 8/8 control groups, every listed member, zero raw leaks and zero incomplete fixtures accepted as clean. Pivot on fewer than five groups or any failed control. Unqualified fixture setup is inconclusive. Before admitting the experiment, freeze exact byte/time/resource bounds and bounded producer/consumer completion semantics. No live release approval follows from the fixture gate. Update the publishing guide and CLI reference, then run the required full source gate.

Anchors: issue #564 and Basili, Caldiera, Rombach (1994), GQM. Primary scanner contracts: https://github.com/gitleaks/gitleaks/blob/v8.30.1/cmd/git.go and https://github.com/gitleaks/gitleaks/blob/v8.30.1/sources/git.go.

## Scanner source qualification
Gitleaks 8.30.1 default Git argv lacks an explicit merge-diff mode. Git log
suppresses merge diffs by default. A fixed --log-opts with
--diff-merges=separate could emit merge-only additions, so Git mode is not
inherently incapable of finding them. Two independent blockers remain.
Gitleaks sources/git.go lines 299–304 logs the Git child Wait error at debug
level and discards it. Lines 327–332 skip non-archive binary patches.
Neither a zero scanner exit nor one merge positive proves completeness.

Stdin also has a skip hazard. sources/file.go returns success for
application MIME and fragments input using reads and whitespace. Therefore
do not feed unframed Git output directly into stdin or infer completeness
from status 0. Produce complete typed records from an independently checked
Git traversal. Give each scanner call one bounded text record, scanner
input from a sealed regular scratch file, and a fixed ASCII text preamble
that the submitted rule cannot match. Reject binary, malformed UTF-8,
unsupported regex or any record outside the qualified scanner profile.
Assert full consumption with a separate fixed end canary rule and exactly
one corresponding report row. Reserve 19 for findings and expect it even
for clean records with that canary. Only strip the exact reserved canary
rule ID after validating the bounded report. Test that start/end anchors
and multiline expressions cannot change semantics across this framing.
If framing equivalence is unavailable, stop rather than accept the scan.

For content compare root against empty and every non-root commit against
each named parent, using Git plumbing with explicit no-renames/no-ext-diff/
no-textconv and fixed output. A two-parent merge contributes comparisons
against both parent trees. Use separately framed raw metadata and path
records so Git display quoting and mailmap never hide required bytes.
Verify the producer finished successfully before accepting any scanner
summary. Do not implement a new Git object reader.

## Proposed calibration caps

These are private pre-result fixture caps, not production capacity claims.
Per fixture allow 8 refs, 12 commits, 2 parents per commit, 2 annotated
tags, 24 parent/root comparisons, 64 typed scanner records, 1 KiB per
record inclusive of framing, and 64 KiB aggregate scanner input. Allow
256 KiB total Git stdout, 256 KiB aggregate scanner reports, 4 KiB
per child stderr, 8 MiB owned scratch, and one active child. Apply limits
before allocation, use cap+1 detection and refuse on saturation. The
scratch cap needs a source-proven admission/creation bound. A post-clone
size walk alone cannot enforce it. For calibration, generate only a sealed
small local synthetic source and deny external writes. Per-child deadline
2 s and total invocation deadline 30 s, including cleanup. Invalid resource
conditions or harness timeouts are inconclusive. Any incomplete execution
must expose only fixed outer exit 2, with no clean summary.

## Exact proposed synthetic-only commands

Run only after a docs prediction commit and fixture review. Fixture test
name filters refer to proposed tests in the new history test file. Fixture
runner pins the already installed 8.30.1 binary and runs inside scratch.

```sh
JOBS=1 heavy-run npx vitest run --maxWorkers=1 \
  src/plugins/leak-audit-history.test.ts -t '564 scanner calibration'
JOBS=1 heavy-run npx vitest run --maxWorkers=1 \
  src/plugins/leak-audit-history.test.ts src/plugins/leak-audit.test.ts
```

The calibration test executes this closed scanner operation with generated
trusted config, empty ignore, sealed stdin and scratch report paths:

```sh
"$fixture_gitleaks" stdin --config "$fixture_config" \
  --gitleaks-ignore-path "$fixture_empty_ignore" --ignore-gitleaks-allow \
  --redact=100 --no-banner --no-color --timeout=2 --exit-code=19 \
  --max-archive-depth=0 --max-decode-depth=0 --report-format=json \
  --report-path "$fixture_report" < "$fixture_record"
```

Require 8/8 calibration cases: clean framed record, planted marker,
root addition, merge-only addition absent from both parents, longest
admitted frame with marker at end, missing tail canary refusal, rejected
non-text record, and injected producer failure after partial bytes.
Also require 0 raw payload leaks and 0 incomplete scans accepted as clean.
The 5/5 surface and 8/8 control requirements stay separate. A missing
tool, ambiguous regex equivalence, unproven scratch bound or a missed
calibration case blocks implementation acceptance.

Primary contracts: https://git-scm.com/docs/git-log and
https://github.com/gitleaks/gitleaks/tree/v8.30.1/sources.

## Production admission

The synthetic caps apply only to calibration. Before real-repository admission, separately register and prove source enumeration, Git subprocess and object expansion, mirror creation, scanner work and cleanup bounds. A size check after cloning is insufficient. Qualify env regex compatibility, complete parent and path enumeration, source drift and binary handling. Refusal cannot satisfy the positive all-history criterion for a supported repository. No real-repository audit or release approval follows from the fixture result.
