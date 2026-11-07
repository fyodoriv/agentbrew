# Reviewer runner: local identity supplement

The imported-report preparation merged as Agentbrew `2ad649b16ade3e218ecd57e1866e31f6ee0b6269`.
Before each admitted runner test, require these exact SHA-256 values from that
tree: `hooks/lib/review_ask_report.py` is
`20cd19b406d367b17b98916b40ad06bd4854f11df4b77879497db0642160c249`, and
`hooks/lib/review_ask_imported_report_test.py` is
`1983e66e2a040fe9b4d246e44dc44577a5095513cf4b9ef58f815238cafb45ee`.
The frozen event-file hashes remain those in the runner plan.

For this local synthetic experiment only, the selected interpreter is the
absolute regular executable
`/Applications/Xcode.app/Contents/Developer/Library/Frameworks/Python3.framework/Versions/3.9/bin/python3.9`.
On Nov 7 it reported Python 3.9.6, owner UID 0, mode 0755, size 102352 and
SHA-256 `c5a13e37785524fbc0384539d3c99aa4f888cb7c89e13e0bf0018436378b13bc`.
Check these values and reject a symlink or changed identity before each run.
Use an explicit clean environment with `PATH=/usr/bin:/bin` and no `BASH_ENV`
or Python loader overrides. The interactive shell resolves a different Python;
do not substitute it. These facts pin the executable for this experiment,
not every library or operating-system component.

The owned fake-process timeout and all cleanup constraints in the runner plan
remain unchanged. A missing or changed prerequisite is inconclusive; do not
select a replacement or run a live hook without a new registration.
