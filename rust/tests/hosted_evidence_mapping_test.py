#!/usr/bin/python3
"""Compile the real closed mapping without compiling or running the worker."""
from pathlib import Path
import os
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
worker = (ROOT / 'src/worker_owner.rs').read_text()
receipt = (ROOT / 'src/owner_hosted_receipt.rs').read_text()


def extract(source, start):
    first = source.index(start)
    last = source.index('\n}', first) + 2
    return source[first:last]


observation = extract(worker, '#[derive(Debug)]\nenum Observation')
mapping = extract(worker, 'fn evidence(reason: Observation)')
evidence = extract(receipt, '#[derive(Clone, Copy, Debug, PartialEq, Eq)]\npub(crate) enum Evidence')
tests = r'''
#[test]
fn actual_mapping_uses_closed_categories() {
    use owner_hosted_receipt::Evidence as E;
    let cases = [
        (Observation::SignalSetup, E::SetupFailure),
        (Observation::Request, E::SetupFailure),
        (Observation::StartupCancelled, E::SetupFailure),
        (Observation::IoSetup, E::SetupFailure),
        (Observation::InputIncomplete, E::WorkFailure),
        (Observation::InputWrite, E::WorkFailure),
        (Observation::OutputRead, E::WorkFailure),
        (Observation::OutputWrite, E::WorkFailure),
        (Observation::OutputLimit, E::WorkFailure),
        (Observation::WaitError, E::OwnershipUnknown),
        (Observation::SignalError, E::OwnershipUnknown),
        (Observation::ReapError, E::OwnershipUnknown),
        (Observation::SignalAttempt, E::Intent),
        (Observation::ControlRead, E::Context),
        (Observation::SignalFlag, E::Context),
        (Observation::ParentPresent, E::Context),
        (Observation::WorkDeadline, E::Context),
        (Observation::TerminalCode, E::Context),
        (Observation::TerminalSignal, E::Context),
        (Observation::ReapCode, E::Context),
        (Observation::ReapSignal, E::Context),
        (Observation::ExperimentGuardRefused, E::Context),
        (Observation::Failed, E::Context),
    ];
    assert_eq!(cases.len(), 23);
    for (input, expected) in cases { assert_eq!(evidence(input), expected); }
}
'''

variants = re.findall(r'^\s+([A-Za-z][A-Za-z0-9_]*),$', observation, re.MULTILINE)
covered = re.findall(r'\(Observation::([A-Za-z][A-Za-z0-9_]*),', tests)
if len(variants) != 23 or len(covered) != 23 or set(variants) != set(covered):
    raise SystemExit('closed mapping cases do not match the observation variants')
source = f'#![allow(dead_code)]\nmod owner_hosted_receipt {{ {evidence} }}\n{observation}\n{mapping}\n{tests}'
with tempfile.TemporaryDirectory(prefix='hosted-mapping-') as directory:
    path = Path(directory)
    (path / 'mapping.rs').write_text(source)
    binary = path / 'mapping-tests'
    build = subprocess.run(
        [os.environ.get('RUSTC', 'rustc'), '--edition=2021', '--test', str(path / 'mapping.rs'), '-o', str(binary), '--cfg', 'owner_hosted_experiment'],
        capture_output=True, text=True, timeout=120,
    )
    if build.returncode:
        raise SystemExit('closed mapping harness did not compile')
    result = subprocess.run([str(binary)], capture_output=True, text=True, timeout=30)
    named = re.search(r'^test actual_mapping_uses_closed_categories \.\.\. ok$', result.stdout, re.MULTILINE)
    summary = re.search(r'^test result: ok\. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in .*s$', result.stdout, re.MULTILINE)
    if result.returncode or not named or not summary:
        raise SystemExit('closed mapping controls failed')
    print('closed mapping: 23 cases passed')
