import contextlib
import importlib.util
import io
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("pr_command_target", Path(__file__).with_name("pr-command-target.py"))
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)

class ReviewRequestTests(unittest.TestCase):
    def check_case(self, command, expected):
        with contextlib.ExitStack() as stack:
            guards = [stack.enter_context(patch(name, side_effect=RuntimeError("blocked"))) for name in (
                "subprocess.Popen", "subprocess.run", "os.system", "socket.socket",
            )]
            for guard in guards:
                with self.assertRaisesRegex(RuntimeError, "blocked"):
                    guard()
                guard.reset_mock()
            stdout, stderr = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                result = parser.reviewer_request(command)
                if expected:
                    self.assertEqual(parser.target(command), {"number": "123", "repo": ""})
                    self.assertFalse(parser.reviewer_request(command + " --add-label label"))
            self.assertIs(result, expected)
            self.assertEqual(stdout.getvalue(), "")
            self.assertEqual(stderr.getvalue(), "")
            self.assertNotIn("reviewer_marker_822", stdout.getvalue() + stderr.getvalue())
            for guard in guards:
                guard.assert_not_called()

cases = {
    "positive_separate": ("gh pr edit 123 --add-reviewer reviewer_marker_822", True),
    "positive_equals": ("gh pr edit 123 --add-reviewer=reviewer_marker_822", True),
    "view": ("gh pr view 123", False),
    "remove": ("gh pr edit 123 --remove-reviewer reviewer_marker_822", False),
    "assignee": ("gh pr edit 123 --add-assignee reviewer_marker_822", False),
    "quoted_body": ("gh pr edit 123 --body 'mention --add-reviewer reviewer_marker_822'", False),
    "compound": ("gh pr edit 123 --add-reviewer reviewer_marker_822 && true", False),
    "expansion": ("gh pr edit 123 --add-reviewer $PERSON", False),
    "empty": ("gh pr edit 123 --add-reviewer=", False),
    "unknown_flag": ("gh pr edit 123 --add-reviewer reviewer_marker_822 --unknown", False),
}

def make_case(command, expected):
    def run(self):
        self.check_case(command, expected)
    return run

for name, (command, expected) in cases.items():
    setattr(ReviewRequestTests, f"test_{name}", make_case(command, expected))

if __name__ == "__main__":
    unittest.main()
