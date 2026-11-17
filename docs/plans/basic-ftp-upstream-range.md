# Remove the basic-ftp override

- Hypothesis: get-uri 8.0.2 resolves basic-ftp through its own supported range. The root override count falls from one to zero and the audit shows zero high findings for basic-ftp.
- Measurement: inspect the resolved lock entries, run the audit for basic-ftp, and pass the hosted install and verification gates.
- Success: zero root override entries, get-uri at 8.0.2 with its published dependency range, zero high basic-ftp findings and zero unrelated lock entry changes.
- Pivot: retain the override if the package graph cannot install with its existing declarations or if basic-ftp retains a high finding.
- Anchor: [get-uri 8.0.2](https://www.npmjs.com/package/get-uri/v/8.0.2), which declares basic-ftp ^6.2.4.
