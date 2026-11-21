# Bound status line cold log decoding

The [default-branch macOS gate](https://github.com/fyodoriv/agentbrew/actions/runs/44915634260/job/136880515743)
measured 671 ms for the existing 200,000-row cold read. The threshold
is 500 ms. The current reader converts the whole new segment to a string
before filtering it, then derives the cache offset from that string.

- **Hypothesis**: Search the log in bytes and decode only matching rows.
  Advance the cache by complete disk bytes so unrelated malformed UTF-8
  cannot move the next read past a valid appended row.
- **Measurement**: Run the hosted `src/scripts/agent-perf.test.ts` cases
  with the unchanged full gate. Compare the largest decoded span against
  one selected row and record the exact offset after a malformed line.
  Keep the existing cold and warm timing assertions.
- **Success**: Only the 1 selected fixture row is decoded from the
  mixed segment and 0 unrelated log bytes are decoded. The following
  valid row is counted once. The 200,000-row cold read stays below
  500 ms, and the warm p95 stays below 50 ms.
- **Pivot**: At least 1 lost or doubled row, changed status value,
  decoded unrelated row, or missed timing threshold rejects the change.
- **Anchor**: The exact hosted failure, the existing status line fixture
  and [Node Buffer search and decoding](https://nodejs.org/api/buffer.html#bufindexofvalue-start-end-encoding).

Keep the current file-size scan and existing append format. The timing
test still measures the full cold and warm calls.
