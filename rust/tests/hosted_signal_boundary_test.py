#!/usr/bin/env python3
"""Static mutation controls for the non-runnable hosted signal boundary."""
from pathlib import Path
import unittest
import re

ROOT = Path(__file__).resolve().parents[1]

EXPECTED_SIGNAL = '    fn signal(&mut self, signal: Signal) -> Result<(), SignalFailure> {\n        if !self.reserved {\n            #[cfg(owner_hosted_experiment)]\n            let _ = self\n                .receipt\n                .record(owner_hosted_receipt::Event::Observation(\n                    owner_hosted_receipt::Evidence::OwnershipUnknown,\n                ));\n            return Err(SignalFailure::Unreserved);\n        }\n        let status = self.status();\n        #[cfg(owner_hosted_experiment)]\n        if status.is_err() {\n            let _ = self\n                .receipt\n                .record(owner_hosted_receipt::Event::Observation(\n                    owner_hosted_receipt::Evidence::OwnershipUnknown,\n                ));\n        }\n        status.map_err(|_| SignalFailure::from_wait_error(self.last_error))?;\n        #[cfg(owner_hosted_experiment)]\n        let attempt = if signal == Signal::TERM {\n            owner_hosted_receipt::Event::TermAttempt\n        } else if signal == Signal::KILL {\n            owner_hosted_receipt::Event::KillAttempt\n        } else {\n            return Err(SignalFailure::ExperimentGuardRefused);\n        };\n        #[cfg(owner_hosted_experiment)]\n        if !self.receipt.begin(attempt) {\n            return Err(SignalFailure::ExperimentGuardRefused);\n        }\n        #[cfg(owner_hosted_experiment)]\n        let result = match owner_guarded_dispatch::dispatch(|| kill_process_group(self.pid, signal))\n        {\n            Ok(_) => {\n                self.receipt.invalidate();\n                return Err(SignalFailure::ExperimentGuardRefused);\n            }\n            Err(_) => {\n                let _ = self.receipt.refused();\n                return Err(SignalFailure::ExperimentGuardRefused);\n            }\n        };\n        #[cfg(not(owner_hosted_experiment))]\n        let result = kill_process_group(self.pid, signal);\n        match result {\n            Ok(()) | Err(Errno::SRCH) => Ok(()),\n            Err(error) => {\n                self.last_error = error.raw_os_error();\n                Err(SignalFailure::from_kill_error(error.raw_os_error()))\n            }\n        }\n    }\n\n'
EXPECTED_EVIDENCE = 'fn evidence(reason: Observation) -> owner_hosted_receipt::Evidence {\n    use owner_hosted_receipt::Evidence;\n    match reason {\n        Observation::SignalSetup\n        | Observation::Request\n        | Observation::StartupCancelled\n        | Observation::IoSetup => Evidence::SetupFailure,\n        Observation::InputIncomplete\n        | Observation::InputWrite\n        | Observation::OutputRead\n        | Observation::OutputWrite\n        | Observation::OutputLimit => Evidence::WorkFailure,\n        Observation::WaitError | Observation::SignalError | Observation::ReapError => {\n            Evidence::OwnershipUnknown\n        }\n        Observation::SignalAttempt => Evidence::Intent,\n        Observation::ControlRead\n        | Observation::SignalFlag\n        | Observation::ParentPresent\n        | Observation::WorkDeadline\n        | Observation::TerminalCode\n        | Observation::TerminalSignal\n        | Observation::ExperimentGuardRefused\n        | Observation::ReapCode\n        | Observation::ReapSignal\n        | Observation::Failed => Evidence::Context,\n    }\n}\n'
EXPECTED_REAP = '    fn reap(&mut self) -> Result<std::process::ExitStatus, ReapFailure> {\n        let status = self.status();\n        #[cfg(owner_hosted_experiment)]\n        if status.is_err() {\n            let _ = self\n                .receipt\n                .record(owner_hosted_receipt::Event::Observation(\n                    owner_hosted_receipt::Evidence::OwnershipUnknown,\n                ));\n        }\n        if status.map_err(|_| ReapFailure::Wait)?.is_none() {\n            #[cfg(owner_hosted_experiment)]\n            let _ = self\n                .receipt\n                .record(owner_hosted_receipt::Event::Observation(\n                    owner_hosted_receipt::Evidence::OwnershipUnknown,\n                ));\n            return Err(ReapFailure::NotTerminal);\n        }\n        let status = self.child.wait().map_err(|error| {\n            self.last_error = error.raw_os_error().unwrap_or(-1);\n            #[cfg(owner_hosted_experiment)]\n            let _ = self\n                .receipt\n                .record(owner_hosted_receipt::Event::Observation(\n                    owner_hosted_receipt::Evidence::OwnershipUnknown,\n                ));\n            ReapFailure::ChildWait\n        })?;\n        #[cfg(owner_hosted_experiment)]\n        let _ = self\n            .receipt\n            .record(owner_hosted_receipt::Event::Observation(\n                owner_hosted_receipt::Evidence::Reaped,\n            ));\n        self.reserved = false;\n        Ok(status)\n    }'


def valid_boundary(worker, transport, fixture):
    start = worker.index("    fn signal(&mut self, signal: Signal)")
    end = worker.index("    fn reap(&mut self)", start)
    signal = worker[start:end]
    drop_start = worker.index("impl Drop for Leader")
    drop_end = worker.index("// Only a fresh fixed-operation worker", drop_start)
    drop = worker[drop_start:drop_end]
    marker = "\n#[cfg(not(owner_hosted_experiment))]"
    if marker not in worker:
        return False
    evidence = worker[worker.index("fn evidence(reason: Observation)"):worker.index(marker, worker.index("fn evidence(reason: Observation)"))]
    reap = worker[end:worker.index("\n}\n\nimpl Drop for Leader", end)]
    return (signal.strip() == EXPECTED_SIGNAL.strip()
            and evidence.strip() == EXPECTED_EVIDENCE.strip()
            and reap.strip() == EXPECTED_REAP.strip()
            and worker.count("kill_process_group(") == 2
            and '#[cfg(owner_hosted_experiment)]\n        let result = match owner_guarded_dispatch::dispatch(|| kill_process_group(self.pid, signal))' in signal
            and '#[cfg(not(owner_hosted_experiment))]\n        let result = kill_process_group(self.pid, signal);' in signal
            and 'let _ = self.receipt.refused();' in signal
            and 'self.receipt.invalidate();' in signal
            and 'if !self.receipt.begin(attempt)' in signal
            and '#[cfg(not(owner_hosted_experiment))]\nfn observe(' in worker
            and '$leader.receipt.record(owner_hosted_receipt::Event::Observation(evidence($reason)))' in re.sub(r'\s+', '', worker)
            and re.sub(r'\s+', '', worker).count('owner_hosted_receipt::Evidence::Terminal') == 1
            and re.sub(r'\s+', '', worker).count('owner_hosted_receipt::Evidence::Stop') == 1
            and re.sub(r'\s+', '', worker).count('owner_hosted_receipt::Event::Spawned') == 1
            and 'self.receipt.record(owner_hosted_receipt::Event::Drop)' in drop
            and 'self.signal(Signal::TERM)' in drop and 'self.signal(Signal::KILL)' in drop
            and re.sub(r'\s+', '', worker).count('Observation::ExperimentGuardRefused,0') == 2
            and '#[cfg(owner_hosted_experiment)]\n    ExperimentGuardRefused = 33' in transport
            and '#[cfg(owner_hosted_experiment)]\n            33 => Self::ExperimentGuardRefused' in transport
            and '#[cfg(not(owner_hosted_experiment))]\ncompile_error!' in fixture
            and 'fn main() {}' in fixture)


class BoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.worker = (ROOT / 'src/worker_owner.rs').read_text()
        cls.transport = (ROOT / 'src/transport.rs').read_text()
        cls.fixture = (ROOT / 'owner-hosted-fixture/src/main.rs').read_text()

    def test_boundary_and_distinct_refusal_are_present(self):
        self.assertTrue(valid_boundary(self.worker, self.transport, self.fixture))
        for path in ('src/lib.rs', 'src/main.rs', 'tests/fixtures/lifecycle.rs'):
            self.assertIn('compile_error!(\"owner_hosted_experiment is forbidden in the main package\")', (ROOT / path).read_text())

    def test_bypass_and_cfg_removal_mutations_are_rejected(self):
        mutations = [
            (self.worker.replace('owner_guarded_dispatch::dispatch(|| kill_process_group', 'unguarded(|| kill_process_group'), self.fixture),
            (self.worker.replace('#[cfg(not(owner_hosted_experiment))]\n        let result', '        let result'), self.fixture),
            (self.worker, self.fixture.replace('#[cfg(not(owner_hosted_experiment))]\ncompile_error!', 'compile_error!')),
            (self.worker.replace('self.signal(Signal::KILL)', 'other_cleanup()'), self.fixture),
            (self.worker.replace('Evidence::OwnershipUnknown', 'Evidence::Context', 1), self.fixture),
            (self.worker.replace('Evidence::Reaped', 'Evidence::Context', 1), self.fixture),
            (self.worker.replace('owner_hosted_receipt::Evidence::Terminal', 'owner_hosted_receipt::Evidence::Context', 1), self.fixture),
            (self.worker.replace('owner_hosted_receipt::Evidence::Stop', 'owner_hosted_receipt::Evidence::Context', 1), self.fixture),
            (self.worker.replace('owner_hosted_receipt::Event::Spawned', 'owner_hosted_receipt::Event::Drop', 1), self.fixture),
            (self.worker.replace('if !self.receipt.begin(attempt)', 'if false'), self.fixture),
            (self.worker.replace('self.receipt.record(owner_hosted_receipt::Event::Drop)', 'true'), self.fixture),
            (self.worker.replace('#[cfg(not(owner_hosted_experiment))]\nfn observe(', 'fn observe('), self.fixture),
            (self.worker.replace('        let status = self.status();\n', '        return Ok(());\n        let status = self.status();\n', 1), self.fixture),
            (self.worker.replace('        #[cfg(owner_hosted_experiment)]\n        let result = match', '        // #[cfg(owner_hosted_experiment)]\n        let result = match', 1), self.fixture),
        ]
        for worker, fixture in mutations:
            with self.subTest(worker=worker != self.worker, fixture=fixture != self.fixture):
                self.assertFalse(valid_boundary(worker, self.transport, fixture))


if __name__ == '__main__':
    unittest.main()
