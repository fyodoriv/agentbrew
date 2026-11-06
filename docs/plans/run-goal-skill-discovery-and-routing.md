# Run-goal skill rediscovery and command identity

Prospective plan for issues #793 and #795. Prepared on 2026-11-06 from
main `2bfbf2ea97d438c932b77f3f349af067a3bc56b6`. This document registers the prospective prediction. It is not implementation,
a live host observation or a passing experiment.
Commit the prediction and the complete appendix before regression assertions,
eval additions, guidance changes or target measurements.

## Observed source boundary

`run-goal/SKILL.md` Phase 1 lists relevant skills once. It already distinguishes
CLI commands from slash commands, but does not require post-install skill
rediscovery or exact collision evidence for the requested slash identity.
`references/execution.md` handles mid-goal user corrections, not a newly
available skill satisfying an original conditional requirement.

`agentbrew commands list --json` exists in
`src/commands/cli-sync-subcommands.ts`. Its version-one readiness result
identifies the winning command source and target artifacts. Per
`docs/command-readiness.md`, ready deployment is not proof that the current
host invokes the requested command. `src/commands/cli-skills.ts` offers
validation and coverage; it has no `agentbrew skills list` operation.

Reuse `src/skills/validate.ts::validateEvals`, the `SkillEval` type and existing
structured fixture/oracle conventions. Keep answer keys in `expected_output`
and expectations, never in actor input. No runtime parser, dependency,
agent implementation, catalog entry, host API or settings change is needed.

## Current primary host evidence

Verified 2026-11-06:

- [Claude skill precedence](https://code.claude.com/docs/en/skills#resolve-skills-that-share-a-name):
  local skills beat matching legacy command files. Other source categories
  have separate rules. Do not apply this rule to Codex or cloud hosts.
- [Claude live edits](https://code.claude.com/docs/en/skills#edit-a-skill-during-a-session):
  supported skill directories are watched except in bare mode. A top-level
  directory created after startup needs a reload; plugin components have
  separate reload rules. Documentation is not an exposed tool acknowledgment.
- [Official Codex skill documentation](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills):
  describes automatic skill detection, a restart fallback, and separate
  selectors for equal names. It does not establish a refresh/list API available
  to this agent. Source deployment and current-session invocation stay separate.

Do not restart a session, alter account syncing/privacy, edit native storage,
rename an owner skill or invent a qualified legacy-command route. Use only
operations actually exposed to the executing host. If a required discovery or
invocation is unavailable, retain an explicit unverified criterion and do
independent authorized work.

## Narrow source change

1. Extend Phase 1 skill discovery with a short reference to the execution
   procedure. After an install/refresh that can change relevant skills, read
   supported discovery again, inspect the exact identity/source, and reconsider
   original conditional steps. When their condition is evidenced true, load
   and invoke the required skill once and verify its result. Repeated discovery
   does not authorize another invocation or installation.
2. For an intended slash command, inspect matching live skills and exact
   command readiness identities. Record evidenced collisions or unresolved
   precedence in Assumptions and Risks. Verify the requested winner before
   completion. Without a supported route or authorized correction, preserve
   the criterion unverified. Do not ask solely because basenames match.
3. Preserve literal CLI argv. A matching slash skill is not a reason to
   reinterpret or block an explicitly requested CLI command.
4. Append the four frozen eval objects in the appendix. Extend the existing
   `src/skills/run-goal-owner-and-proof.test.ts` with structured fixture checks,
   source-guidance requirements, schema validation and prefix preservation.
   Preserve existing external-wait and fresh-intake tests.

Expected changed implementation paths:
`skill-plugins/workflow/run-goal/SKILL.md`,
`skill-plugins/workflow/run-goal/references/execution.md`,
`skill-plugins/workflow/run-goal/evals/evals.json`,
`src/skills/run-goal-owner-and-proof.test.ts`, and this plan.
Task intake/closeout may also change `TASKS.md`. Do not grow `AGENTS.md`.

## Frozen experiment and proof limits

GQM goal: preserve conditional requirements after capabilities change and
route a requested command by evidenced identity. Question: does the guidance
cover each sealed success, unavailable-capability, collision and literal-CLI
control without granting unsupported host actions?

Baseline target checks are unmeasured. Prediction: at least one registered
guidance guard fails against unchanged guidance; after the narrow correction,
all four guard groups pass and missing guidance guards are zero. Each fixture
must have at least three independent nonempty checks. Require the exact input
and oracle fields below, not only a regex proving a case exists.

Success: 4/4 fixed fixture groups and every registered guidance assertion pass;
zero schema errors or duplicate IDs; zero changed original eval objects;
zero actor-input answer keys; zero unsupported operations, duplicate
invocations, owner mutations or literal-CLI reinterpretations in the authored
oracles. Preserve existing goal ownership, quiet waiting and task-intake guards.

Pivot: any omitted case, missing check, changed historical object, fake live
invocation, unsupported precedence/refresh, lost original criterion,
unauthorized owner edit or CLI reinterpretation rejects the approach. If RED
finds no missing guidance guard, stop and revise the diagnosis before changing
guidance. Do not weaken the fixtures after observing results.

These deterministic checks establish fixture integrity and guidance coverage.
They do not run an actor through host discovery, prove model decisions improve,
prove native refresh works, or measure a field recurrence rate. A future
behavioral decision evaluation needs a supported actor harness, frozen model
and budget, transcript/tool-result evidence, an independent grader and a
separate prediction before execution. No such run is authorized or claimed here.
Do not present a simulated fixture outcome as live host completion.

Anchors: Basili, Caldiera and Rombach (1994), Goal Question Metric;
[Munafò et al. (2017)](https://doi.org/10.1038/s41562-016-0021), preregistration;
primary host documentation and command-readiness contract above.

## Original eval-object preservation

At this base the original eval array contains 246 objects and ends at ID 246.
IDs 247–250 were independently checked free during preparation; this is not a
reservation. Recheck immediately before registration. If any are occupied,
stop and amend the prediction's IDs before any target execution.

Original file SHA256:
`bc2b1d9e3f5d417bd43bfd347e23a736c966aa577c1085ba857cd0bc02ef5b37`.

Freeze SHA256 of JavaScript `JSON.stringify(evals.slice(0, 246))`:
`094653b7aa5e5f52327d22b434913597ae0506b0e625433e26cb89ef56acd562`.
Protect complete object values and insertion order, not only IDs/prompts.
After appending, the file hash changes but this object-prefix hash must not.
Keep the earlier first-245-object guard unchanged. An additive fixture must
preserve both guards; a planted historical object mutation must fail the
new guard. This is a preservation control, not a reason to edit history.

## Registered execution order

1. Commit this complete plan/prediction after the docs/task gate. No target
   assertions, eval additions or guidance changes before that commit.
2. Add the frozen evals and their source-guidance guards; keep SKILL.md and
   execution guidance unchanged. Capture RED from the exact focused command.
   Distinguish expected missing-guidance assertions from fixture/setup errors.
3. Make only the guidance correction, then run the identical focused command
   for GREEN with unchanged fixtures, oracles and historical objects.
4. Review independent evidence, run coverage and changed-file validation,
   then one normal required full gate. Keep logs, source/tree hashes and real
   terminal codes. Do not edit while a gate runs. Later docs/task-only closeout
   can use a narrow gate without repeating unchanged runtime qualification.
5. Deploy through the managed source/sync procedure and compare installed
   skill/reference/eval bytes. That is deployment evidence; current-session
   skill invocation remains unproved without actual host readback.

Exact focused command, after registration:

```sh
JOBS=1 heavy-run node node_modules/vitest/vitest.mjs run \
  src/skills/run-goal-owner-and-proof.test.ts \
  src/skills/run-goal-external-waits.test.ts \
  src/skills/run-goal-live-task-intake.test.ts --maxWorkers=1
JOBS=1 heavy-run npm run skills:coverage
JOBS=1 heavy-run npm run verify:changed -- 2bfbf2ea97d438c932b77f3f349af067a3bc56b6
JOBS=1 NO_CACHE=1 heavy-run npm run verify
```

Use the existing validators and fixtures. `skills:coverage` reports structural
and eval-schema coverage; it is not a current-session skill inventory. Normal
repo gates may inspect configuration; never add a live host invocation or
install/refresh command to these read-only synthetic controls.

## Estimate before execution

Active effort low/likely/high: 30/60/120 minutes. Elapsed: 55/100/180 minutes.
Components: fixture/guard work 15/30/60, guidance/docs 5/10/20, review and
resolution 10/20/40 active minutes. Full-gate elapsed allowance 15/25/40 minutes,
plus zero/15/40 minutes for composition and queue uncertainty. The just-completed
privacy qualification took about 20 minutes end to end, including a 986-second
full suite; do not assume a seconds-long docs gate predicts full-gate time.
No external actor cost or live-session restart is included. Revisit when RED,
review and the actual gate duration are known; keep these original estimates.

## Pre-registration review correction

Independent review found that case 247 combined empty invocation history with
an unqualified result record. Before prediction commit or target execution,
label that record as a scripted response available only after the next
authorized invocation, never as prior completion evidence. Keep invocation
history empty and the exactly-once oracle unchanged. Preserve the original
private proposal for provenance. No measured result caused this correction.

## Aggregate preservation amendment (Nov 6, 2026)

Register this correction before reproducing or changing the aggregate guard.
The preceding full ended successfully: 6,431 passed, 33 skipped, all twenty
steps fresh, exit zero, on preserved tree `5ba6923e`. Independent review then
identified that the new test guard rejects valid future additions. A passing
old candidate does not qualify the changed guard. No new aggregate control
has run; the before values below are prospective predictions.

## Frozen source and narrow scope

- Prediction: `971ce13461fc87777b8b13d21b22beddedb5a3a2`.
- Preserved pre-amendment candidate: `5ba6923e7e22bcda450787de2f3f8d067fb38ad9`.
- Current eval file SHA256:
  `4c82df9506a5adb741b1af1979aaa89fb15d936e7b493ba1cfae0e41c29f2534`.
- Original first-246-object SHA256:
  `094653b7aa5e5f52327d22b434913597ae0506b0e625433e26cb89ef56acd562`.
- Registered four-case private package SHA256:
  `65cca1446f2e9e9574646f23abc43bc110ab9cb103f054ac01eb7a0d8be93952`.

Keep SKILL.md, execution guidance and every original/registered eval object
unchanged. Keep the 399-line budget and preserved 405-line failure unchanged.
The correction belongs only to the existing owner-and-proof test's aggregate
preservation contract and this prospective plan amendment. It is not a host,
actor, model or runtime behavior change.

## Finding

The current normal-file test applies object equality, exact IDs and an
expectations-only minimum to the entire open tail `evals.slice(246)`.
Consequently, a valid appended case is refused. A valid case using the schema's
`assertions` alternative also fails the tail's expectations-only check.

The existing later-addition test exercises only prefixHash and supplies an
object without required SkillEval fields or schema checks. That does not prove
the actual aggregate contract accepts valid additions.

## Shared aggregate contract

Use one test-local aggregate function for both the normal current-file
assertion and every synthetic control. It reads the authoritative array from
that skill directory's evals/evals.json, uses the existing SkillEval type, and
calls the real `validateEvals(skillDir)` against that same file.

Retain all current decisions:

1. Complete original first-246-object prefix hash.
2. Registered-object equality with the committed frozen appendix.
3. Exact registered ID sequence 247, 248, 249, 250.
4. Registered expectations minimum, unchanged at three.
5. Whole-array uniqueness.
6. Whole-array existing schema validation, including its expectations OR
   assertions and nonempty-check behavior.

Initially extract the current behavior faithfully: the registered-object,
ID and minimum-check decisions all use the existing unbounded slice(246).
Do not fix the bound during extraction. Verify the current-file normal
assertion uses this SAME aggregate function, not a parallel/prefix-only path.

Only after RED, bound those registration-specific decisions to the exact
registered segment, slice(246,250). Preserve the original hash, whole-array
uniqueness/schema, every registered value and every numeric threshold.

## Seven frozen controls

Each row uses a separate private scratch skill directory containing a cloned
copy of the frozen current array. Mutation rows deliberately change only
copies. The production eval file and appendix never change. Future IDs here
are local fixture values, not reservations or additions to the shipped evals.
Exact deterministic input descriptors are in the companion controls JSON.
Derive that control base from the frozen first 250 object values, verifying
the original prefix and exact registered four. Later real contributions must
not become part of this local control base or collide with its synthetic IDs.

| ID | Input transformation | Expected contract | Required decisive guard |
| --- | --- | --- | --- |
| current | Current 250-object array unchanged | Accept | Every aggregate field passes |
| future-expectations | Append valid local case 251 with three expectations | Accept | Exact registered package stays bounded; whole-array schema/uniqueness pass |
| future-assertions | Append valid local case 252 with three assertions and no expectations | Accept | Schema alternative stays supported outside the registered segment |
| duplicate-future | Append two valid local objects sharing future ID 251 | Refuse | Whole-array duplicate detection and actual validator diagnostic |
| empty-future | Append local case 251 with an empty expectations array | Refuse | Actual validator's nonempty-check minimum |
| original-mutation | Append a fixed marker to expected_output of original ID 245 | Refuse | Original first-246-object hash |
| registered-mutation | Append a fixed marker to expected_output of registered ID 250 | Refuse | Complete registered-object equality, including the segment's final element |

The exact equality decision still covers all registered objects 247–250;
the last-element mutation tests the upper boundary without adding an eighth
control. No actor/oracle fixture is revised in response to an outcome.

## Pre-registered metric and pivot

GQM: preserve registered fixtures while accepting schema-valid future
contributions. Question: can the SAME normal-file aggregate contract classify
all seven fixed controls without dropping historical or schema protection?

Predict false valid-input refusals fall from two to zero. The faithful old
contract is predicted to accept only current and reject both valid additions;
the corrected contract must accept all three valid controls and refuse all
four invalid controls. These before values are predictions, not observed
measurements. Require zero production historical or registered-four changes.

Success: 3/3 valid accepted; 4/4 invalid refused through their decisive guards;
zero false valid refusals; all existing fixture/owner/wait/intake tests remain
green; original prefix and registered package hashes stay unchanged; required
qualification passes on the new source.

Pivot: any accepted invalid control, refused valid control, lost registered
minimum/equality decision, changed original object, different validator or
prefix-only substitute rejects the approach. If faithful extraction does not
produce the predicted two valid-refusal REDs, stop and inspect the contract
before changing the representation. Do not revise the expected outcomes.

Anchor: Basili, Caldiera and Rombach (1994), GQM; Munafò et al. (2017),
preregistration; the actual SkillEval and validateEvals contracts.

## Execution order after root review

1. Let the original full terminate and preserve its result, full candidate,
   line-budget evidence and private package unchanged.
2. Add the reviewed prospective amendment to the source plan only. Qualify a
   normal docs-only prediction commit before any reproduction/helper/control
   code or target measurement. The root owns that commit.
3. Extract the faithful old aggregate, route the existing normal-file test
   through it, and add the seven controls with unchanged expected decisions.
   Use real scratch JSON files and the actual validator. Capture RED before
   bounding any registered slice or check.
4. Correct only the registered-segment bound. Execute the identical controls
   GREEN, preserving source evidence and every control/oracle byte.
5. Run fresh qualification for changed source. The earlier full is evidence
   about its earlier candidate, never a substitute for this new source gate.
   This is a scoped new correction, not retrying unchanged code.

Focused command after the prediction and controls exist:

```sh
JOBS=1 heavy-run node node_modules/vitest/vitest.mjs run src/skills/run-goal-owner-and-proof.test.ts src/skills/run-goal-external-waits.test.ts src/skills/run-goal-live-task-intake.test.ts --maxWorkers=1
```

Then use the repo's applicable changed/full qualification on the corrected
source. Do not execute any command in this proposal while the original full
is active or before the root's normal docs prediction commit.

### Exact aggregate-control descriptors

```json
{
  "status": "private prospective descriptors; no controls executed",
  "baseEvalFileSha256": "4c82df9506a5adb741b1af1979aaa89fb15d936e7b493ba1cfae0e41c29f2534",
  "historicalPrefixSha256": "094653b7aa5e5f52327d22b434913597ae0506b0e625433e26cb89ef56acd562",
  "registeredPackageSha256": "65cca1446f2e9e9574646f23abc43bc110ab9cb103f054ac01eb7a0d8be93952",
  "fixtureIdsAreEvalReservations": false,
  "expectationsAddition": {
    "id": 251,
    "prompt": "Synthetic later contribution using expectations.",
    "expected_output": "Synthetic expected response.",
    "expectations": [
      "Retains the synthetic input identity.",
      "Reports only the supplied fixture evidence.",
      "Does not claim an unsupported side effect."
    ]
  },
  "assertionsAddition": {
    "id": 252,
    "prompt": "Synthetic later contribution using assertions.",
    "expected_output": "Synthetic expected response.",
    "assertions": [
      "Retains the synthetic input identity.",
      "Reports only the supplied fixture evidence.",
      "Does not claim an unsupported side effect."
    ]
  },
  "controls": [
    {
      "id": "current",
      "transform": "clone frozen base without changes",
      "accepted": true
    },
    {
      "id": "future-expectations",
      "transform": "append exact expectationsAddition object",
      "accepted": true
    },
    {
      "id": "future-assertions",
      "transform": "append exact assertionsAddition object, with no expectations property",
      "accepted": true
    },
    {
      "id": "duplicate-future",
      "transform": "append two separate clones of expectationsAddition with identical ID 251",
      "accepted": false,
      "requiredGuard": "whole-array uniqueness and actual validateEvals duplicate-id diagnostic"
    },
    {
      "id": "empty-future",
      "transform": "append a clone of expectationsAddition with expectations replaced by an empty array",
      "accepted": false,
      "requiredGuard": "actual validateEvals nonempty-check minimum"
    },
    {
      "id": "original-mutation",
      "transform": "clone base; append originalMutationSuffix to expected_output of the object whose id is 245",
      "originalMutationSuffix": " synthetic historical mutation",
      "accepted": false,
      "requiredGuard": "original first-246-object prefix hash"
    },
    {
      "id": "registered-mutation",
      "transform": "clone base; append registeredMutationSuffix to expected_output of the object whose id is 250",
      "registeredMutationSuffix": " synthetic registered mutation",
      "accepted": false,
      "requiredGuard": "registered complete-object equality including ID 250"
    }
  ],
  "prediction": {
    "falseValidRefusalsBefore": 2,
    "falseValidRefusalsAfter": 0,
    "validAcceptedAfter": 3,
    "invalidRefusedAfter": 4,
    "historicalSourceChangesAllowed": 0,
    "registeredFourSourceChangesAllowed": 0
  }
}
```

## Results (Nov 6, 2026)

Prediction registration preceded target assertions and guidance edits. The initial guidance reproduction had four expected missing-guidance failures and 28 passing tests. The identical focused command passed 32 tests after the correction, with the four sealed fixtures and historical objects unchanged.

The initial changed gate found a real line-budget failure: SKILL.md measured 405 lines against the strict fewer-than-400-line contract. Only the new routing/discovery text was folded into existing paragraphs; its guidance meaning and every oracle stayed fixed. The corrected source measures 399 split lines. The failed 662-pass/two-failure receipt remains distinct from the later passing changed gate.

Independent review then found that an open-ended registered-segment guard rejected valid future eval additions. The separately committed aggregate amendment registered seven exact controls before their execution. The faithful shared aggregate reproduced two valid-input false refusals (36 tests passed). Bounding only registration-specific checks to objects 246 through 249 removed both false refusals: the identical controls passed 38 tests, accepting all three valid inputs and refusing all four invalid inputs. The actual-file assertion uses the same aggregate and real validator as the scratch controls. Whole-array uniqueness/schema checks still cover future entries, including assertions-only evals. IDs 251/252 exist only in temporary controls; the shipped array ends at 250.

Typecheck and changed-file Biome passed. The first isolated coverage run failed before measurement because its long scratch TMPDIR exceeded the macOS Unix-socket path limit. That failed receipt was retained. Only the same coverage command was repeated with a short scratch path, and it passed; both scratch homes were removed. The final changed gate passed 670 tests across 69 files and 22 deterministic artifact checks. Task preregistration lint, task stability, security, coverage and the normal zero-match leak check executed.

After composition with main `cf5de2e95951473cdc7ae42b4dc51973255fa4f5`, one fresh uncached full gate qualified the independently approved corrected candidate `cde29ab593cd33bca039bb4108c9eb87add26998` at integration commit `8574064222221ce4b5b344d8072743c98a521bd1`. Actual inner and outer exits were zero: 6,456 tests passed, 33 skipped, 420 files passed and two files skipped. All 20 steps ran fresh. The normal installer gate reported no changed install path. The full gate took 946,207 ms; Vitest took 847.75 seconds. Source hashes and the entire unstaged diff matched before and after. The earlier full result on the prior aggregate did not qualify this correction.

Original eval-object prefix SHA256 remains `094653b7aa5e5f52327d22b434913597ae0506b0e625433e26cb89ef56acd562`; the earlier 245-object guard is unchanged. The final eval file SHA256 is `4c82df9506a5adb741b1af1979aaa89fb15d936e7b493ba1cfae0e41c29f2534`.

These results establish deterministic fixture integrity, schema preservation and source-guidance coverage. They do not establish improved actor decisions, a live host refresh or successful current-session invocation. The authored guidance preserves owner artifacts and literal CLI requests and requires actual exposed capabilities. Managed deployment/readback remains a delivery step; deployment bytes alone will not prove invocation.

The fresh full gate took about 15.8 minutes, within the original 15/25/40-minute gate allowance. The unexpected budget and aggregate corrections required extra review and qualification cycles. Active end-to-end time was not instrumented, so no retrospective active-time number is claimed. For future estimates, include an explicit additive-eval aggregate review and strict skill-line-budget check before full qualification. Keep the original estimates above unchanged.

## Frozen eval appendix

The objects below are prospective additions, not executed test results.
Actor inputs contain fixture observations only. Outcomes are grader-only.

```json
[
  {
    "id": 247,
    "prompt": "Simulated decision trace only. Do not run commands, invoke tools, mutate files or claim these supplied observations are live results. Read the synthetic input and state the next actions and evidence needed. Repeated identical observations do not authorize duplicate side effects.\n\nSkill rediscovery fixture:\n```json\n{\n  \"goal\": \"Install the fixture plugin. If review-fixture becomes available, run it once for task alpha before completion.\",\n  \"host\": \"synthetic capability trace, not a live host result\",\n  \"initialDiscovery\": [],\n  \"events\": [\n    {\n      \"event\": \"install-completed\",\n      \"artifact\": \"fixture/plugin-r1\",\n      \"status\": \"success\"\n    },\n    {\n      \"event\": \"supported-discovery-readback\",\n      \"skills\": [\n        {\n          \"name\": \"review-fixture\",\n          \"identity\": \"review-fixture-r1\",\n          \"sourcePath\": \"/fixture/plugin/skills/review-fixture/SKILL.md\",\n          \"bodyDigest\": \"sha256:1111111111111111111111111111111111111111111111111111111111111111\",\n          \"availableInCurrentSession\": true,\n          \"invocable\": true\n        }\n      ]\n    }\n  ],\n  \"exposedCapabilities\": [\n    \"read current skill metadata\",\n    \"read the exact discovered skill source\",\n    \"invoke the discovered identity\"\n  ],\n  \"invocationHistory\": [],\n  \"scriptedInvocationResponse\": {\n    \"condition\": \"Produced only after the next authorized invocation of review-fixture-r1 for alpha; not prior completion evidence\",\n    \"response\": {\n      \"identity\": \"review-fixture-r1\",\n      \"task\": \"alpha\",\n      \"result\": \"fixture-review-ok\"\n    }\n  }\n}\n```",
    "expected_output": "Preserve the original goal and only use the fixture-exposed capabilities. Apply the independently registered outcomes below without treating deployment, disk presence or a ready flag as proof of the requested invocation.\n\nSkill rediscovery oracle:\n```json\n{\n  \"criterionRetained\": true,\n  \"discoveryReadsAfterInstall\": 1,\n  \"loadedIdentity\": \"review-fixture-r1\",\n  \"invocations\": [\n    {\n      \"identity\": \"review-fixture-r1\",\n      \"task\": \"alpha\"\n    }\n  ],\n  \"evidence\": \"fixture-review-ok\",\n  \"inventedOperations\": 0,\n  \"repeatDiscoveryDuplicateInvocations\": 0\n}\n```",
    "expectations": [
      "Re-reads supported current-session discovery after the installation event and loads exactly review-fixture-r1 from its evidenced source.",
      "Retains the original conditional requirement; when availability becomes true, invokes that identity exactly once for task alpha and checks the matching fixture-review-ok readback.",
      "A repeated identical discovery readback does not repeat the invocation or installation side effect; invents no refresh/list operation or live execution claim."
    ]
  },
  {
    "id": 248,
    "prompt": "Simulated decision trace only. Do not run commands, invoke tools, mutate files or claim these supplied observations are live results. Read the synthetic input and state the next actions and evidence needed. Repeated identical observations do not authorize duplicate side effects.\n\nUnavailable skill discovery fixture:\n```json\n{\n  \"goal\": \"Install the fixture plugin. If review-fixture becomes available, run it once for task alpha before completion.\",\n  \"host\": \"synthetic constrained host\",\n  \"initialDiscovery\": [],\n  \"events\": [\n    {\n      \"event\": \"install-completed\",\n      \"artifact\": \"fixture/plugin-r1\",\n      \"status\": \"success\"\n    },\n    {\n      \"event\": \"disk-readback\",\n      \"path\": \"/fixture/plugin/skills/review-fixture/SKILL.md\",\n      \"bodyDigest\": \"sha256:1111111111111111111111111111111111111111111111111111111111111111\"\n    }\n  ],\n  \"exposedCapabilities\": [\n    \"read files\"\n  ],\n  \"currentSessionDiscovery\": null,\n  \"nativeRefreshOperation\": null,\n  \"nativeInvocationOperation\": null,\n  \"independentWork\": \"Read the public fixture README without changing it\"\n}\n```",
    "expected_output": "Preserve the original goal and only use the fixture-exposed capabilities. Apply the independently registered outcomes below without treating deployment, disk presence or a ready flag as proof of the requested invocation.\n\nUnavailable skill discovery oracle:\n```json\n{\n  \"criterionRetained\": true,\n  \"skillInvocationVerdict\": \"unverified\",\n  \"diskIsInvocationProof\": false,\n  \"invocations\": [],\n  \"inventedOperations\": 0,\n  \"newSessions\": 0,\n  \"nativeStoreEdits\": 0,\n  \"independentWorkMayContinue\": true\n}\n```",
    "expectations": [
      "Distinguishes the installed file and its digest from current-session discovery and invocation; retains the original conditional criterion unverified.",
      "Does not invent agentbrew skills list, a host refresh/list API, a native invocation acknowledgment or a successful skill run.",
      "Creates no new session, edits no native host storage, changes no privacy or account-sync setting, and continues only independent authorized work."
    ]
  },
  {
    "id": 249,
    "prompt": "Simulated decision trace only. Do not run commands, invoke tools, mutate files or claim these supplied observations are live results. Read the synthetic input and state the next actions and evidence needed. Repeated identical observations do not authorize duplicate side effects.\n\nSlash routing fixture:\n```json\n{\n  \"goal\": \"Make the repository /work command run. Keep the existing personal work skill intact.\",\n  \"host\": \"Claude Code local terminal session\",\n  \"requestedSource\": {\n    \"identity\": \"repo-command-work-r1\",\n    \"sourcePath\": \"/fixture/repo/commands/work.md\"\n  },\n  \"supportedCommandReadiness\": {\n    \"version\": 1,\n    \"commands\": [\n      {\n        \"filename\": \"work.md\",\n        \"sourcePath\": \"/fixture/repo/commands/work.md\",\n        \"targets\": [\n          {\n            \"agent\": \"claude-code\",\n            \"path\": \"/fixture/home/.claude/commands/work.md\",\n            \"ready\": true,\n            \"status\": \"ready\"\n          }\n        ]\n      }\n    ]\n  },\n  \"currentSessionSkills\": [\n    {\n      \"name\": \"work\",\n      \"identity\": \"personal-skill-work-r1\",\n      \"sourcePath\": \"/fixture/home/.claude/skills/work/SKILL.md\",\n      \"invocable\": true\n    }\n  ],\n  \"precedenceEvidence\": {\n    \"source\": \"https://code.claude.com/docs/en/skills#resolve-skills-that-share-a-name\",\n    \"rule\": \"A local skill wins over a same-name file in .claude/commands/.\"\n  },\n  \"invocationObservation\": {\n    \"typed\": \"/work\",\n    \"selectedIdentity\": \"personal-skill-work-r1\",\n    \"result\": \"fixture-personal-work\"\n  },\n  \"supportedQualifiedRoutes\": [],\n  \"sourceCorrectionAuthorization\": false\n}\n```",
    "expected_output": "Preserve the original goal and only use the fixture-exposed capabilities. Apply the independently registered outcomes below without treating deployment, disk presence or a ready flag as proof of the requested invocation.\n\nSlash routing oracle:\n```json\n{\n  \"collisionRiskRecorded\": true,\n  \"deployedCommandIdentity\": \"repo-command-work-r1\",\n  \"observedWinner\": \"personal-skill-work-r1\",\n  \"requestedCommandInvocationVerdict\": \"unverified\",\n  \"qualifiedRoute\": null,\n  \"ownerArtifactMutations\": 0,\n  \"goalComplete\": false\n}\n```",
    "expectations": [
      "Compares the exact requested repo-command-work-r1 source and deployed target with the current-session personal-skill-work-r1 identity; records the evidenced collision in Assumptions and Risks.",
      "Uses the Claude-specific precedence and observed personal-skill winner; ready deployment is not requested-command invocation proof.",
      "Keeps the original /work invocation requirement unverified because no supported qualified route or source correction authorization exists; does not mark the goal complete.",
      "Does not fabricate a namespace for the local legacy command, delete or rename the owner skill, or invoke the shadowed command by pretending deployment changed host precedence.",
      "Requires a real supported route or authorized source correction and matching invocation readback before completion; does not ask solely because the basenames match."
    ]
  },
  {
    "id": 250,
    "prompt": "Simulated decision trace only. Do not run commands, invoke tools, mutate files or claim these supplied observations are live results. Read the synthetic input and state the next actions and evidence needed. Repeated identical observations do not authorize duplicate side effects.\n\nLiteral CLI routing fixture:\n```json\n{\n  \"goal\": \"Run the literal CLI command tool work --check. Do not invoke an agent slash command.\",\n  \"requestedArgv\": [\n    \"tool\",\n    \"work\",\n    \"--check\"\n  ],\n  \"availableSkills\": [\n    {\n      \"name\": \"work\",\n      \"identity\": \"personal-skill-work-r1\",\n      \"sourcePath\": \"/fixture/home/.agents/skills/work/SKILL.md\"\n    }\n  ],\n  \"availableCli\": {\n    \"executable\": \"/fixture/bin/tool\",\n    \"argv\": [\n      \"work\",\n      \"--check\"\n    ],\n    \"readOnly\": true\n  },\n  \"commandReadback\": {\n    \"argv\": [\n      \"tool\",\n      \"work\",\n      \"--check\"\n    ],\n    \"exit\": 0,\n    \"stdout\": \"fixture-cli-check-ok\"\n  },\n  \"slashInvocationRequested\": false\n}\n```",
    "expected_output": "Preserve the original goal and only use the fixture-exposed capabilities. Apply the independently registered outcomes below without treating deployment, disk presence or a ready flag as proof of the requested invocation.\n\nLiteral CLI routing oracle:\n```json\n{\n  \"selectedArgv\": [\n    \"tool\",\n    \"work\",\n    \"--check\"\n  ],\n  \"slashInvocations\": 0,\n  \"collisionBlockers\": 0,\n  \"ownerArtifactMutations\": 0,\n  \"requestedCliCheckVerdict\": \"met\",\n  \"evidence\": \"fixture-cli-check-ok\"\n}\n```",
    "expectations": [
      "Preserves the literal tool work --check argv and uses the available CLI path rather than a slash skill with the same basename.",
      "Checks the exact CLI argv, exit zero and fixture-cli-check-ok readback before marking only that requested check met.",
      "Introduces zero slash invocations, collision blockers, needless basename questions or owner artifact edits; does not generalize Claude routing precedence to Codex."
    ]
  }
]
```
