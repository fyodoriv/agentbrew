# Record selected native writes before they start

The opt-in selected publisher and its signer descriptor already retain
the process owner after an interrupted write. The owner record alone
cannot identify which output was intended. This experiment covers the
selected path. It adds no automatic retry or activation.

- **Hypothesis**: A selected publication records every planned file's
  previous and expected digest and mode before its first native write.
  A failed write keeps the same private record and later invocations
  refuse without changing it.
- **Measurement**: Run the selected native tests with
  `heavy-run npm exec -- vitest run src/plugins/claude-native.test.ts src/plugins/claude-native-ordinary.test.ts`.
  Inspect the record at the first output write in a cold signed fixture.
  Check the two hook files, envelope, private receipt and marketplace
  index. Fail after the first write and compare the record and outputs
  before and after retry. Compare a normal run's final bytes and modes to
  the record observed before writes. Repeat on a signed warm extension.
- **Success**: All five cold file rows and all changed warm rows have the
  exact prior and expected values, the record has mode 0600, and there
  are zero new writes on refusal. Zero raw file contents or absolute
  paths in the record. A completed operation removes its owned record.
- **Pivot**: Any unlisted write, wrong digest or mode, late record,
  incomplete result accepted as complete, or ordinary regression stops
  promotion. Refuse before writing on unknown paths, duplicate physical
  names, invalid expected modes, more than 1024 rows, or a record over
  256 KiB. A partial record and damaged output must retain the original
  refusal behavior.
- **Anchor**: The process-ownership and interrupted-write controls in
  [native publication facet ownership](native-publication-facet-ownership.md).

Store the intent in the existing process-owner file under the verified
home directory. Use home-relative paths and SHA-256 digests without raw
output bytes. Synchronize the existing descriptor before allowing
output. Verify the owner and complete file results before removing it.
The directory tree and settings remain outside this selected-file
experiment. The full certified and ordinary paths have no new intent
format here.
