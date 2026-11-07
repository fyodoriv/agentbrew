import contextlib
import importlib.util
import io
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parent
RUNNER = ROOT / "review_ask_event_runner.py"
PYTHON = Path(sys.executable).resolve()
NAMES = (
    "test_failure_event_silent", "test_input_is_not_disclosed", "test_interrupted_event_silent",
    "test_malformed_event_silent", "test_matching_event_reminds", "test_unrelated_command_silent",
)
spec = importlib.util.spec_from_file_location("review_ask_event_runner", RUNNER)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def owned_child(script, home, timeout=5):
    env = {"HOME": str(home), "PATH": "/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1"}
    child = subprocess.Popen(
        ["/bin/bash", "-c", 'exec "$1" "$2"', "runner", str(PYTHON), str(script)],
        cwd=str(home), env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    try:
        out, err = child.communicate(timeout=timeout)
        return child.returncode, out.decode("utf-8"), err.decode("utf-8")
    finally:
        if child.poll() is None:
            child.kill()
        child.communicate(timeout=3)


def synthetic_suite(kind):
    def passing(_self):
        pass

    def failing(self):
        self.fail("synthetic failure")

    methods = {name: passing for name in NAMES}
    if kind == "failure":
        methods[NAMES[0]] = failing
    elif kind == "skip":
        methods[NAMES[0]] = unittest.skip("synthetic skip")(passing)
    elif kind == "missing":
        del methods[NAMES[0]]
    elif kind == "extra":
        methods["test_extra"] = passing
    methods["__module__"] = "review_ask_event_fixture"
    case = type("ReviewAskEventTest", (unittest.TestCase,), methods)
    return unittest.TestLoader().loadTestsFromTestCase(case)


def scratch_runner(root, event_source):
    for name in ("review_ask_event_runner.py", "review_ask_report.py"):
        shutil.copyfile(ROOT / name, root / name)
    (root / "review_ask_event_test.py").write_text(event_source, encoding="utf-8")
    return root / "review_ask_event_runner.py"


class RunnerTest(unittest.TestCase):
    def test_actual_event_suite(self):
        with tempfile.TemporaryDirectory() as path:
            code, out, err = owned_child(RUNNER, Path(path))
        self.assertTrue(code == 0 and out == "review event runner: 6 passed\n" and err == "", "runner placeholder")

    def test_failing_suite(self):
        self.assertFalse(runner.evaluate_suite(synthetic_suite("failure")))

    def test_skipped_suite(self):
        self.assertFalse(runner.evaluate_suite(synthetic_suite("skip")))

    def test_missing_case(self):
        self.assertFalse(runner.evaluate_suite(synthetic_suite("missing")))

    def test_extra_case(self):
        self.assertFalse(runner.evaluate_suite(synthetic_suite("extra")))

    def test_import_failure(self):
        marker = "synthetic-import-error-marker"
        with tempfile.TemporaryDirectory() as path:
            root = Path(path)
            script = scratch_runner(root, f'raise RuntimeError("{marker}")\n')
            code, out, err = owned_child(script, root)
        self.assertEqual(code, 1)
        self.assertEqual(out, "review event runner unavailable\n")
        self.assertEqual(err, "")
        self.assertNotIn(marker, out + err)

    def test_private_output(self):
        markers = ("synthetic-stdout-marker", "synthetic-stderr-marker", "synthetic-error-marker")
        captured_out, captured_err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(captured_out), contextlib.redirect_stderr(captured_err):
            print(markers[0])
            print(markers[1], file=sys.stderr)
            try:
                raise RuntimeError(markers[2])
            except RuntimeError as error:
                print(error, file=sys.stderr)
        self.assertIn(markers[0], captured_out.getvalue())
        self.assertIn(markers[1], captured_err.getvalue())
        self.assertIn(markers[2], captured_err.getvalue())
        methods = "\n".join(f"    def {name}(self): pass" for name in NAMES[1:])
        source = (
            "import sys, unittest\nclass ReviewAskEventTest(unittest.TestCase):\n"
            f"    def {NAMES[0]}(self):\n"
            f"        print({markers[0]!r}); print({markers[1]!r}, file=sys.stderr); raise RuntimeError({markers[2]!r})\n"
            + methods + "\n"
        )
        with tempfile.TemporaryDirectory() as path:
            root = Path(path)
            script = scratch_runner(root, source)
            code, out, err = owned_child(script, root)
        self.assertEqual(code, 1)
        self.assertEqual(out, "review event runner unavailable\n")
        self.assertEqual(err, "")
        for marker in markers:
            self.assertNotIn(marker, out + err)

    def test_direct_child_timeout(self):
        with tempfile.TemporaryDirectory() as path:
            root = Path(path)
            sentinel = root / "pid"
            fake = root / "fake-python"
            fake.write_text(f"#!/bin/bash\nprintf '%s' \"$$\" > {shlex.quote(str(sentinel))}\nwhile :; do :; done\n", encoding="utf-8")
            fake.chmod(0o700)
            wrapper = root / "wrapper"
            wrapper.write_text(f"#!/bin/bash\nexec {shlex.quote(str(fake))}\n", encoding="utf-8")
            env = {"HOME": str(root), "PATH": "/usr/bin:/bin"}
            child = subprocess.Popen(["/bin/bash", str(wrapper)], cwd=str(root), env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            timed_out = False
            try:
                deadline = time.monotonic() + 3
                while not sentinel.exists() and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertTrue(sentinel.exists())
                self.assertEqual(int(sentinel.read_text(encoding="utf-8")), child.pid)
                try:
                    child.communicate(timeout=1)
                except subprocess.TimeoutExpired:
                    timed_out = True
            finally:
                if child.poll() is None:
                    child.kill()
                child.communicate(timeout=3)
            self.assertTrue(timed_out)
            self.assertIsNotNone(child.returncode)
            self.assertLess(child.returncode, 0)


if __name__ == "__main__":
    unittest.main()
