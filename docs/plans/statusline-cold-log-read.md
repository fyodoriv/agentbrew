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

A small disposable probe decoded 201 bytes for one matching 66-byte row.
After a malformed byte, the reader reported 5,000 ms when an appended row
should have brought the total to 6,000 ms. Decoding the complete buffer
caused the extra work. Recounting the decoded text advanced the cache past
the first bytes of the next row.

## Refresh older status line caches once

- **Hypothesis**: A cache written by the old reader can lose a new row
  or count an earlier row twice. A versioned cache rebuilds the byte
  positions and totals together once and reuses the rebuilt result.
- **Measurement**: Seed the former cache shape with an offset 2 bytes
  beyond the complete log. Exercise one upgrade before another append
  and one upgrade with a new row already present.
- **Success**: Both upgrade paths report the exact total. The first
  reports 5,000 ms before append and 6,000 ms after append. The second
  starts at 6,000 ms. A repeat adds 0 rows. The timing limits stay fixed.
- **Pivot**: At least 1 lost or doubled row, repeated cold read, or
  timing regression rejects the new cache shape.
- **Anchor**: The former decoded-text offset and the exact byte-offset
  controls above.

The disposable baseline counted 10,000 ms before append in the first
case and only 5,000 ms after append in the second. The version check
rebuilds both saved values together.
