# teachback test harness for Python exercises (stdlib only).
# Runs one unittest module from the current folder and prints a single JSON
# line, prefixed with a marker, describing every test outcome.
import json
import os
import sys
import traceback
import unittest

MARK = "@@TEACHBACK_RESULT@@"
sys.dont_write_bytecode = True
sys.path.insert(0, os.getcwd())


def short_error(err, solution):
    etype, value, tb = err
    message = "".join(traceback.format_exception_only(etype, value)).strip()
    where = None
    for frame in traceback.extract_tb(tb):
        if os.path.basename(frame.filename) == solution:
            where = "%s:%d" % (solution, frame.lineno)
    return message, where


class Collect(unittest.TestResult):
    def __init__(self, solution):
        super().__init__()
        self.solution = solution
        self.records = []

    def _name(self, test):
        name = getattr(test, "_testMethodName", None) or str(test)
        doc = test.shortDescription() if hasattr(test, "shortDescription") else None
        return name, doc

    def _add(self, test, status, err=None):
        name, doc = self._name(test)
        rec = {"name": name, "status": status}
        if doc:
            rec["doc"] = doc
        if err is not None:
            rec["message"], rec["where"] = short_error(err, self.solution)
        self.records.append(rec)

    def addSuccess(self, test):
        super().addSuccess(test)
        self._add(test, "pass")

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self._add(test, "fail", err)

    def addError(self, test, err):
        super().addError(test, err)
        self._add(test, "error", err)

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self._add(test, "skip")

    def addSubTest(self, test, subtest, err):
        super().addSubTest(test, subtest, err)
        if err is not None:
            self._add(subtest, "fail" if issubclass(err[0], test.failureException) else "error", err)


def main():
    modules = [m for m in sys.argv[1].split(",") if m]
    solution = sys.argv[2] if len(sys.argv) > 2 else ""
    result = Collect(solution)
    try:
        suite = unittest.defaultTestLoader.loadTestsFromNames(modules)
        suite.run(result)
    except BaseException:
        message, where = short_error(sys.exc_info(), solution)
        result.records.append({"name": "import", "status": "error", "message": message, "where": where})
    sys.stdout.flush()
    print("\n" + MARK + json.dumps({"tests": result.records}), flush=True)


if __name__ == "__main__":
    main()
