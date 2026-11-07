import importlib.util
from pathlib import Path
import unittest


spec = importlib.util.spec_from_file_location("review_ask_report", Path(__file__).with_name("review_ask_report.py"))
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)
validate = getattr(parser, "valid_imported_report", lambda _text, _status=None: False)


def report(module="review_ask_event_fixture", stock=False):
    lines = []
    for name in parser.NAMES:
        suffix = "" if stock else ".test_" + name
        lines.append(f"test_{name} ({module}.ReviewAskEventTest{suffix}) ... ok")
    return "\n".join(lines + ["", "Ran 6 tests in 0.001s", "", "OK", ""])


class ImportedReportTest(unittest.TestCase):
    def test_imported_new(self):
        self.assertTrue(validate(report(), 0), "imported report placeholder")

    def test_imported_stock(self):
        self.assertTrue(validate(report(stock=True), 0))

    def test_wrong_module(self):
        self.assertFalse(validate(report(module="other_fixture"), 0))
        self.assertFalse(validate(report(module="__main__"), 0))
        self.assertFalse(parser.valid_report(report(), 0))

    def test_skipped(self):
        self.assertFalse(validate(report().replace("... ok", "... skipped 'fixture'", 1), 0))

    def test_extra(self):
        first = report().splitlines()[0]
        self.assertFalse(validate(report() + first + "\n", 0))
        self.assertFalse(validate(report() + "test_extra (review_ask_event_fixture.ReviewAskEventTest.test_extra) ... ok\n", 0))
        self.assertFalse(validate(report().replace(first + "\n", "", 1), 0))

    def test_failed_status(self):
        for status in (1, False, None, "0"):
            self.assertFalse(validate(report(), status))
        self.assertFalse(validate(report() + "Ran 7 tests in 0.001s\n", 0))
        self.assertFalse(validate(report() + "FAILED (failures=1)\n", 0))


if __name__ == "__main__":
    unittest.main()
