#!/usr/bin/env python3
"""Static mutation controls for the non-runnable hosted signal boundary."""
from pathlib import Path
import unittest
import re

ROOT = Path(__file__).resolve().parents[1]

EXPECTED_SIGNAL = '    fn signal(&mut self, signal: Signal) -> Result<(), SignalFailure> {\n        if !self.reserved {\n            return Err(SignalFailure::Unreserved);\n        }\n        self.status()\n            .map_err(|_| SignalFailure::from_wait_error(self.last_error))?;\n        #[cfg(owner_hosted_experiment)]\n        let attempt = if signal == Signal::TERM {\n            owner_hosted_receipt::Event::TermAttempt\n        } else if signal == Signal::KILL {\n            owner_hosted_receipt::Event::KillAttempt\n        } else {\n            return Err(SignalFailure::ExperimentGuardRefused);\n        };\n        #[cfg(owner_hosted_experiment)]\n        if !self.receipt.begin(attempt) {\n            return Err(SignalFailure::ExperimentGuardRefused);\n        }\n        #[cfg(owner_hosted_experiment)]\n        let result = match owner_guarded_dispatch::dispatch(|| kill_process_group(self.pid, signal))\n        {\n            Ok(_) => {\n                self.receipt.invalidate();\n                return Err(SignalFailure::ExperimentGuardRefused);\n            }\n            Err(_) => {\n                let _ = self.receipt.refused();\n                return Err(SignalFailure::ExperimentGuardRefused);\n            }\n        };\n        #[cfg(not(owner_hosted_experiment))]\n        let result = kill_process_group(self.pid, signal);\n        match result {\n            Ok(()) | Err(Errno::SRCH) => Ok(()),\n            Err(error) => {\n                self.last_error = error.raw_os_error();\n                Err(SignalFailure::from_kill_error(error.raw_os_error()))\n            }\n        }\n    }\n'


def valid_boundary(worker, transport, fixture):
    start = worker.index("    fn signal(&mut self, signal: Signal)")
    end = worker.index("    fn reap(&mut self)", start)
    signal = worker[start:end]
    drop_start = worker.index("impl Drop for Leader")
    drop_end = worker.index("// Only a fresh fixed-operation worker", drop_start)
    drop = worker[drop_start:drop_end]
    return (signal.strip() == EXPECTED_SIGNAL.strip()
            and worker.count("kill_process_group(") == 2
            and '#[cfg(owner_hosted_experiment)]\n        let result = match owner_guarded_dispatch::dispatch(|| kill_process_group(self.pid, signal))' in signal
            and '#[cfg(not(owner_hosted_experiment))]\n        let result = kill_process_group(self.pid, signal);' in signal
            and 'let _ = self.receipt.refused();' in signal
            and 'self.receipt.invalidate();' in signal
            and 'if !self.receipt.begin(attempt)' in signal
            and '#[cfg(not(owner_hosted_experiment))]\nfn observe(' in worker
            and '$leader.receipt.record(owner_hosted_receipt::Event::Observation)' in re.sub(r'\s+', '', worker)
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
            (self.worker.replace('if !self.receipt.begin(attempt)', 'if false'), self.fixture),
            (self.worker.replace('self.receipt.record(owner_hosted_receipt::Event::Drop)', 'true'), self.fixture),
            (self.worker.replace('#[cfg(not(owner_hosted_experiment))]\nfn observe(', 'fn observe('), self.fixture),
            (self.worker.replace('        self.status()\n', '        return Ok(());\n        self.status()\n', 1), self.fixture),
            (self.worker.replace('        #[cfg(owner_hosted_experiment)]\n        let result = match', '        // #[cfg(owner_hosted_experiment)]\n        let result = match', 1), self.fixture),
        ]
        for worker, fixture in mutations:
            with self.subTest(worker=worker != self.worker, fixture=fixture != self.fixture):
                self.assertFalse(valid_boundary(worker, self.transport, fixture))


if __name__ == '__main__':
    unittest.main()
