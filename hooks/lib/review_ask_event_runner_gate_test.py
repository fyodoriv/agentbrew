from pathlib import Path
import subprocess
import tempfile
import unittest


WRAPPER = Path(__file__).resolve().parent.parent / "checks" / "review-ask-event-runner.test.sh"
NAMES = ("actual_event_suite", "direct_child_timeout", "extra_case", "failing_suite", "import_failure", "missing_case", "private_output", "skipped_suite")


def report(stock=False):
    lines = []
    for name in NAMES:
        suffix = "" if stock else ".test_" + name
        lines.append(f"test_{name} (__main__.RunnerTest{suffix}) ... ok")
    return "\n".join(lines + ["", "Ran 8 tests in 0.001s", "", "OK", ""])


class GateTest(unittest.TestCase):
    def run_case(self, mode, output, exit_code=0):
        self.assertTrue(WRAPPER.is_file(), "event runner wrapper missing")
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            root.chmod(0o700)
            binary = root / "bin"
            binary.mkdir()
            fake = binary / "python3"
            fake.write_text(
                "#!/bin/bash\n"
                "printf '%s\\n' \"$FAKE_MODE\" >> \"$FAKE_LOG\"\n"
                "while IFS= read -r line; do printf '%s\\n' \"$line\"; done < \"$FAKE_REPORT\"\n"
                "exit \"$FAKE_EXIT\"\n",
                encoding="utf-8",
            )
            fake.chmod(0o700)
            report_file = root / "report"
            report_file.write_text(output, encoding="utf-8")
            sentinel = root / "invoked"
            env = {
                "HOME": str(root),
                "PATH": f"{binary}:/usr/bin:/bin",
                "FAKE_MODE": mode,
                "FAKE_LOG": str(sentinel),
                "FAKE_REPORT": str(report_file),
                "FAKE_EXIT": str(exit_code),
            }
            completed = subprocess.run(
                ["/bin/bash", str(WRAPPER)], cwd=root, env=env, capture_output=True, timeout=5, check=False
            )
            self.assertEqual(sentinel.read_text(encoding="utf-8"), mode + "\n")
            return completed.returncode

    def test_valid(self):
        self.assertEqual(self.run_case("valid_new", report()), 0)
        self.assertEqual(self.run_case("valid_stock", report(True)), 0)

    def test_nonzero(self):
        self.assertNotEqual(self.run_case("nonzero", report(), 7), 0)

    def test_missing(self):
        first = report().splitlines()[0] + "\n"
        self.assertNotEqual(self.run_case("missing", report().replace(first, "", 1)), 0)

    def test_skipped(self):
        self.assertNotEqual(self.run_case("skipped", report().replace("... ok", "... skipped 'fixture'", 1)), 0)

    def test_extra(self):
        first = report().splitlines()[0]
        self.assertNotEqual(self.run_case("extra", report() + "test_unexpected (__main__.RunnerTest.test_unexpected) ... ok\n"), 0)
        self.assertNotEqual(self.run_case("duplicate", report() + first + "\n"), 0)

    def test_forged(self):
        for mode, tail in (("ran", "Ran 9 tests in 0.001s\n"), ("ok", "OK\n"), ("failed", "FAILED (failures=1)\n")):
            self.assertNotEqual(self.run_case(mode, report() + tail), 0)


if __name__ == "__main__":
    unittest.main()
