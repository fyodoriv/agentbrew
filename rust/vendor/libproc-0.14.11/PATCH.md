# Temporary bounded group-query preparation

This is the published libproc 0.14.11 source, from the archive and checksum in
UPSTREAM.json. Keep its MIT LICENSE. UPSTREAM.json records every original file
before local changes. Unmodified upstream source and the owned safe patch have
separate owners; this folder is not an inventory exemption.

The first API-preparation baseline adds safe capacity and native-return
validation controls with fail-closed stubs in src/libproc/sys/bounded_group.rs.
The application test module includes that exact safe file. This runs the
registered application unit command without compiling upstream FFI or its
build script yet. The next focused checkpoint implements only those safe
validators after the baseline reached its actual assertions. No native group
proof or supervisor behavior is enabled.

After an actual assertion red, the registered next step moves the existing
upstream data-query FFI block unchanged into a shared helper and adds a safe
bounded group API. The bounded path must validate its cap before allocation;
it must bypass the old queried-count allocation. Full, malformed and failed
results do not prove completeness. No new unsafe block is permitted.

The temporary patch is removed when a reviewed upstream bounded API replaces
it, after locked-source comparison and the same native controls. No public
contribution or shared Cargo registry edit is authorized by this source copy.

The native-API baseline adds a safe public result type and a fail-closed query
stub in src/processes.rs. The application adds the registered Darwin-only path
dependency. Its read-only native ABI control asks for one PID slot from the
current controlled Cargo group, then requires a filled, non-complete result.
It logs no PID and performs no signal or host-policy change. This is not a
singleton, ownership or exhaustion proof. Upstream FFI and build.rs remain
byte-for-byte original at this baseline. The native query body must not be
implemented before its actual assertion red and source-patch review.

The native candidate routes the public bounded API through the checked safe
validators and a group-filtered query. The old count-query API and new bounded
API share one data-query helper. The existing upstream data-query unsafe block
is moved byte-for-byte; the other unsafe blocks are unchanged. Before that
unchanged length-setting block, safe guards reject misaligned or excessive
returned lengths. The bounded path checks capacity before allocation and never
calls the count-query path. PATCH.diff and PATCH.json record the owned source
changes and preserved unsafe block hashes. This candidate awaits outside review
and native execution. Supervisor EPERM handling is still unchanged.

The example output comments in examples/procinfo.rs use home placeholders for
public-repository privacy. PATCH.json records the original file and line hashes,
the two replacement comment lines, and the final file hash. Apply this separate
documentation patch after PATCH.diff. The code patch and all five original unsafe
block contents are unchanged. The original archive remains the reconstruction
source; removed absolute paths are not copied into the patch artifact.
