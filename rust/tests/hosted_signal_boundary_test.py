#!/usr/bin/env python3
"""Static mutation controls for the non-runnable hosted signal boundary."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

EXPECTED_SIGNAL = """    fn signal(&mut self, signal: Signal) -> Result<(), SignalFailure> {
        if !self.reserved {
            return Err(SignalFailure::Unreserved);
        }
        self.status()
            .map_err(|_| SignalFailure::from_wait_error(self.last_error))?;
        #[cfg(owner_hosted_experiment)]
        let result = match owner_guarded_dispatch::dispatch(|| kill_process_group(self.pid, signal))\n        {
            Ok(result) => result,
            Err(_) => return Err(SignalFailure::ExperimentGuardRefused),
        };
        #[cfg(not(owner_hosted_experiment))]
        let result = kill_process_group(self.pid, signal);
        match result {
            Ok(()) | Err(Errno::SRCH) => Ok(()),
            Err(error) => {
                self.last_error = error.raw_os_error();
                Err(SignalFailure::from_kill_error(error.raw_os_error()))
            }
        }
    }
"""


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
            and 'Err(_) => return Err(SignalFailure::ExperimentGuardRefused)' in signal
            and 'self.signal(Signal::TERM)' in drop and 'self.signal(Signal::KILL)' in drop
            and worker.count('Observation::ExperimentGuardRefused, 0') == 2
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
            (self.worker.replace('        self.status()\n', '        return Ok(());\n        self.status()\n', 1), self.fixture),
            (self.worker.replace('        #[cfg(owner_hosted_experiment)]\n        let result = match', '        // #[cfg(owner_hosted_experiment)]\n        let result = match', 1), self.fixture),
        ]
        for worker, fixture in mutations:
            with self.subTest(worker=worker != self.worker, fixture=fixture != self.fixture):
                self.assertFalse(valid_boundary(worker, self.transport, fixture))


if __name__ == '__main__':
    unittest.main()
