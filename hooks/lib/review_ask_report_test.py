import importlib.util
import os
from pathlib import Path
import socket
import subprocess
import unittest
from unittest.mock import patch

calls = []


def denied(*_args, **_kwargs):
    calls.append(1)
    raise RuntimeError("sentinel denied")


patches = [
    patch.object(subprocess, "Popen", denied),
    patch.object(os, "system", denied),
    patch.object(socket, "create_connection", denied),
    patch.object(socket.socket, "connect", denied),
]
for item in patches:
    item.start()
for entry in (subprocess.Popen, os.system, socket.create_connection, socket.socket.connect):
    try:
        entry()
    except RuntimeError as error:
        assert str(error) == "sentinel denied"
    else:
        raise AssertionError("sentinel failed")
assert len(calls) == 4
calls.clear()
spec = importlib.util.spec_from_file_location("review_ask_report", Path(__file__).with_name("review_ask_report.py"))
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)

NAMES = (
    "failure_event_silent",
    "input_is_not_disclosed",
    "interrupted_event_silent",
    "malformed_event_silent",
    "matching_event_reminds",
    "unrelated_command_silent",
)


def report(stock=False):
    lines = []
    for name in NAMES:
        suffix = "" if stock else ".test_" + name
        lines.append(f"test_{name} (__main__.ReviewAskEventTest{suffix}) ... ok")
    return "\n".join(lines + ["", "Ran 6 tests in 0.001s", "", "OK", ""])


class ReportTest(unittest.TestCase):
    def tearDown(self):
        self.assertEqual(calls, [])

    @classmethod
    def tearDownClass(cls):
        for item in reversed(patches):
            item.stop()

    def test_valid_new(self):
        self.assertTrue(parser.valid_report(report(), 0))

    def test_valid_stock(self):
        self.assertTrue(parser.valid_report(report(True), 0))

    def test_nonzero(self):
        for status in (1, None, False, "0"):
            self.assertFalse(parser.valid_report(report(), status))
        self.assertFalse(parser.valid_report(report()))
        self.assertFalse(parser.valid_report(None, 0))

    def test_missing(self):
        line = report().splitlines()[0] + "\n"
        self.assertFalse(parser.valid_report(report().replace(line, "", 1), 0))

    def test_skipped(self):
        self.assertFalse(parser.valid_report(report().replace("... ok", "... skipped 'fixture'", 1), 0))

    def test_extra_duplicate(self):
        first = report().splitlines()[0]
        self.assertFalse(parser.valid_report(report() + first + "\n", 0))
        self.assertFalse(parser.valid_report(report() + "test_extra (__main__.ReviewAskEventTest.test_extra) ... ok\n", 0))

    def test_forged_summary(self):
        self.assertFalse(parser.valid_report(report() + "FAILED (failures=1)\n", 0))
        self.assertFalse(parser.valid_report(report() + "Ran 7 tests in 0.001s\n", 0))


if __name__ == "__main__":
    unittest.main()
