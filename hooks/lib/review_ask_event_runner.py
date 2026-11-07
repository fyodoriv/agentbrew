import contextlib
import importlib.util
import io
from pathlib import Path
import sys
import unittest


spec = importlib.util.spec_from_file_location("review_ask_report", Path(__file__).with_name("review_ask_report.py"))
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)


def evaluate_suite(suite):
    report = io.StringIO()
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = unittest.TextTestRunner(stream=report, verbosity=2).run(suite)
        valid_result = (
            result.testsRun == 6 and result.wasSuccessful() and not result.skipped and not result.errors
            and not result.failures and not result.unexpectedSuccesses and not result.expectedFailures
        )
        return parser.valid_imported_report(report.getvalue(), 0 if valid_result else 1)
    except BaseException:
        return False


def main():
    valid = False
    module_name = "review_ask_event_fixture"
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            event_spec = importlib.util.spec_from_file_location(module_name, Path(__file__).with_name("review_ask_event_test.py"))
            event_module = importlib.util.module_from_spec(event_spec)
            sys.modules[module_name] = event_module
            event_spec.loader.exec_module(event_module)
            suite = unittest.TestLoader().loadTestsFromTestCase(event_module.ReviewAskEventTest)
            valid = evaluate_suite(suite)
    except BaseException:
        valid = False
    finally:
        sys.modules.pop(module_name, None)
    print("review event runner: 6 passed" if valid else "review event runner unavailable")
    return 0 if valid else 1


if __name__ == "__main__":
    raise SystemExit(main())
