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
spec = importlib.util.spec_from_file_location("review_ask_event", Path(__file__).with_name("review_ask_event.py"))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


def event():
    return {
        "hook_event_name": "PostToolUse",
        "tool_name": "Bash",
        "tool_input": {"command": "gh pr edit 12 --add-reviewer alice"},
        "tool_response": {"interrupted": False},
    }


class ReviewAskEventTest(unittest.TestCase):
    def tearDown(self):
        self.assertEqual(calls, [])

    @classmethod
    def tearDownClass(cls):
        for item in reversed(patches):
            item.stop()

    def test_matching_event_reminds(self):
        self.assertEqual(adapter.reminder(event()), "Verify the reviewer request, then draft the chat review ask.")

    def test_failure_event_silent(self):
        value = event()
        value["hook_event_name"] = "PostToolUseFailure"
        self.assertIsNone(adapter.reminder(value))

    def test_interrupted_event_silent(self):
        value = event()
        value["tool_response"]["interrupted"] = True
        self.assertIsNone(adapter.reminder(value))

    def test_unrelated_command_silent(self):
        value = event()
        value["tool_input"]["command"] = "gh pr view 12"
        self.assertIsNone(adapter.reminder(value))

    def test_malformed_event_silent(self):
        for key in ("tool_input", "tool_response"):
            for invalid in (None, "invalid", [], 0):
                value = event()
                value[key] = invalid
                self.assertIsNone(adapter.reminder(value))
            value = event()
            del value[key]
            self.assertIsNone(adapter.reminder(value))
        value = event()
        value["tool_response"]["interrupted"] = 0
        self.assertIsNone(adapter.reminder(value))
        self.assertIsNone(adapter.reminder(None))

    def test_input_is_not_disclosed(self):
        value = event()
        value["tool_input"]["description"] = "synthetic-secret-marker"
        actual = adapter.reminder(value)
        self.assertEqual(actual, "Verify the reviewer request, then draft the chat review ask.")
        self.assertNotIn("synthetic-secret-marker", actual)


if __name__ == "__main__":
    unittest.main()
