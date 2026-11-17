# Remove the basic-ftp override

- Hypothesis: get-uri 8.0.2 resolves basic-ftp through its own supported range. The root override count falls from one to zero and the audit shows zero high findings for basic-ftp.
- Measurement: inspect the resolved lock entries, run the audit for basic-ftp, and pass the hosted install and verification gates.
- Success: zero root override entries, get-uri at 8.0.2 with its published dependency range, zero high basic-ftp findings and zero unrelated lock entry changes.
- Pivot: retain the override if the package graph cannot install with its existing declarations or if basic-ftp retains a high finding.
- Anchor: [get-uri 8.0.2](https://www.npmjs.com/package/get-uri/v/8.0.2), which declares basic-ftp ^6.2.4.

The lock pins get-uri through pac-proxy-agent 9.1.0, which requests 8.0.1
exactly. Proxy-agent 8.0.3 permits the supported chain:
pac-proxy-agent 9.1.1, get-uri 8.0.2, and basic-ftp 6.2.4 or newer 6.x.
The existing Promptfoo parent range already permits proxy-agent 8.0.3.
Keep every lock entry outside this chain unchanged.
