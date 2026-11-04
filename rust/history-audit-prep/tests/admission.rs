use std::fs::{self, File};
use std::io::Read;
use std::ops::Range;
use std::os::fd::OwnedFd;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use gix_hash::{Kind, ObjectId};
use miniz_oxide::inflate::TINFLStatus;
use miniz_oxide::inflate::core::inflate_flags::{
    TINFL_FLAG_PARSE_ZLIB_HEADER, TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF,
};
use miniz_oxide::inflate::core::{DecompressorOxide, decompress};
use rustix::fs::{FileType, Mode, OFlags, fstat, open, openat};

const REF_BYTES: usize = 4096;
const REF_COUNT: usize = 8;
const INPUT_BYTES: usize = 16 * 1024;
const OUTPUT_BYTES: usize = 8 * 1024;
const HEADER_PREFIX: usize = 32;
const _: () = assert!(std::mem::size_of::<DecompressorOxide>() <= 12 * 1024);
const STEP: Duration = Duration::from_secs(2);
const HASH: Kind = Kind::Sha1;
const SMALL: &[u8] = include_bytes!("data/small.z");
const SMALL_OID: &[u8] = include_bytes!("data/small.oid");
const LARGE: &[u8] = include_bytes!("data/large.z");
const FALSE_SMALL: &[u8] = include_bytes!("data/false-small.z");
const TAG: &[u8] = include_bytes!("data/tag.z");
const TAG_OID: &[u8] = include_bytes!("data/tag.oid");
const PACK: &[u8] = include_bytes!("data/delta.pack");

#[path = "support/effective_refs.rs"]
mod effective_refs;
#[path = "support/packed_delta_slice.rs"]
mod packed_delta_slice;

#[derive(Debug, Eq, PartialEq)]
enum Refusal {
    Io,
    UnsafeLeaf,
    RefBytes,
    RefCount,
    RefEncoding,
    Changed,
    InputBytes,
    Header,
    DeclaredSize,
    Expansion,
    Integrity,
    PackedUnsupported,
    Deadline,
}

#[derive(Default)]
struct Audit {
    ref_parse: usize,
    payload_dispatch: usize,
    retained_bytes: usize,
    max_output: usize,
}

struct Fixture(PathBuf);

impl Fixture {
    fn new(label: &str) -> Self {
        let parent = std::env::temp_dir();
        let path = parent.join(format!("history-admission-{}-{label}", std::process::id()));
        fs::create_dir(&path).expect("synthetic fixture directory");
        Self(path)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).expect("synthetic fixture cleanup");
    }
}

fn check_time(start: Instant) -> Result<(), Refusal> {
    if start.elapsed() > STEP {
        Err(Refusal::Deadline)
    } else {
        Ok(())
    }
}

fn hold(root: &Path) -> Result<OwnedFd, Refusal> {
    open(
        root,
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map_err(|_| Refusal::Io)
}

fn capture_refs(
    root: &OwnedFd,
    bytes: &mut [u8; REF_BYTES],
    between: impl FnOnce(),
) -> Result<usize, Refusal> {
    let start = Instant::now();
    let fd = openat(
        root,
        "packed-refs",
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map_err(|_| Refusal::Io)?;
    let mut file = File::from(fd);
    let before = fstat(&file).map_err(|_| Refusal::Io)?;
    if FileType::from_raw_mode(before.st_mode) != FileType::RegularFile || before.st_nlink != 1 {
        return Err(Refusal::UnsafeLeaf);
    }
    let size = usize::try_from(before.st_size).map_err(|_| Refusal::RefBytes)?;
    if size > bytes.len() {
        return Err(Refusal::RefBytes);
    }
    between();
    file.read_exact(&mut bytes[..size])
        .map_err(|_| Refusal::Changed)?;
    let extra = file.read(&mut [0]).map_err(|_| Refusal::Io)?;
    let after = fstat(&file).map_err(|_| Refusal::Io)?;
    if extra != 0
        || before.st_size != after.st_size
        || before.st_mtime != after.st_mtime
        || before.st_mtime_nsec != after.st_mtime_nsec
        || before.st_ctime != after.st_ctime
        || before.st_ctime_nsec != after.st_ctime_nsec
    {
        return Err(Refusal::Changed);
    }
    check_time(start)?;
    Ok(size)
}

fn packed_refs<'a>(
    bytes: &'a [u8],
    audit: &mut Audit,
) -> Result<Vec<gix_ref::packed::Reference<'a>>, Refusal> {
    let start = Instant::now();
    if bytes.len() > REF_BYTES {
        return Err(Refusal::RefBytes);
    }
    audit.ref_parse += 1;
    let mut refs = Vec::with_capacity(REF_COUNT);
    for record in gix_ref::packed::Iter::new(bytes, HASH).map_err(|_| Refusal::RefEncoding)? {
        let record = record.map_err(|_| Refusal::RefEncoding)?;
        if refs.len() == REF_COUNT {
            return Err(Refusal::RefCount);
        }
        refs.push(record);
    }
    check_time(start)?;
    Ok(refs)
}

fn loose_record<'a>(
    compressed: &[u8],
    expected: &ObjectId,
    output: &'a mut [u8; OUTPUT_BYTES],
    audit: &mut Audit,
) -> Result<(gix_object::Kind, &'a [u8]), Refusal> {
    match decode_loose(compressed, expected, output, audit) {
        Ok((kind, range)) => {
            audit.retained_bytes = range.len();
            Ok((kind, &output[range]))
        }
        Err(reason) => {
            output.fill(0);
            audit.retained_bytes = 0;
            Err(reason)
        }
    }
}

fn decode_loose(
    compressed: &[u8],
    expected: &ObjectId,
    output: &mut [u8; OUTPUT_BYTES],
    audit: &mut Audit,
) -> Result<(gix_object::Kind, Range<usize>), Refusal> {
    let start = Instant::now();
    if compressed.len() > INPUT_BYTES {
        return Err(Refusal::InputBytes);
    }
    if compressed.starts_with(b"PACK") {
        return Err(Refusal::PackedUnsupported);
    }
    let mut decoder = DecompressorOxide::new();
    let flags = TINFL_FLAG_PARSE_ZLIB_HEADER | TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF;
    let (status, consumed, written) = decompress(
        &mut decoder,
        compressed,
        &mut output[..HEADER_PREFIX],
        0,
        flags,
    );
    audit.max_output = written;
    if !matches!(status, TINFLStatus::Done | TINFLStatus::HasMoreOutput) {
        return Err(Refusal::Header);
    }
    let prefix = &output[..written];
    let nul = prefix
        .iter()
        .position(|byte| *byte == 0)
        .ok_or(Refusal::Header)?;
    let space = prefix
        .iter()
        .position(|byte| *byte == b' ')
        .ok_or(Refusal::Header)?;
    if space >= nul {
        return Err(Refusal::Header);
    }
    let (kind, declared, header) =
        gix_object::decode::loose_header(prefix).map_err(|_| Refusal::Header)?;
    let end = usize::try_from(declared)
        .ok()
        .and_then(|n| header.checked_add(n))
        .filter(|n| *n <= output.len())
        .ok_or(Refusal::DeclaredSize)?;
    if written > end {
        return Err(Refusal::Expansion);
    }
    let (input_end, output_end) = if status == TINFLStatus::Done {
        (consumed, written)
    } else {
        audit.payload_dispatch += 1;
        let (status, next_input, next_output) = decompress(
            &mut decoder,
            &compressed[consumed..],
            &mut output[..end],
            written,
            flags,
        );
        audit.max_output = written + next_output;
        if status != TINFLStatus::Done {
            return Err(Refusal::Expansion);
        }
        (consumed + next_input, written + next_output)
    };
    if input_end != compressed.len() || output_end != end {
        return Err(Refusal::Expansion);
    }
    let payload = &output[header..end];
    if gix_object::compute_hash(HASH, kind, payload).map_err(|_| Refusal::Integrity)? != *expected {
        return Err(Refusal::Integrity);
    }
    check_time(start)?;
    Ok((kind, header..end))
}

fn refs_data(names: &[&str]) -> String {
    let oid = std::str::from_utf8(SMALL_OID).expect("synthetic oid");
    let tag = std::str::from_utf8(TAG_OID).expect("synthetic tag oid");
    names
        .iter()
        .map(|name| {
            let target = if *name == "refs/tags/annotated" {
                tag
            } else {
                oid
            };
            format!("{target} {name}\n")
        })
        .collect()
}

fn expected_blob() -> ObjectId {
    ObjectId::from_hex(SMALL_OID).expect("synthetic digest")
}

#[test]
fn a01_all_sealed_packed_ref_names() {
    let names = [
        "refs/heads/a",
        "refs/heads/b",
        "refs/heads/main",
        "refs/notes/a",
        "refs/other/fixture",
        "refs/remotes/origin/main",
        "refs/tags/a",
        "refs/tags/annotated",
    ];
    let data = refs_data(&names);
    assert_eq!(
        data.len(),
        names.iter().map(|name| 42 + name.len()).sum::<usize>()
    );
    let mut audit = Audit::default();
    let refs = packed_refs(data.as_bytes(), &mut audit).unwrap();
    assert_eq!(refs.len(), REF_COUNT);
    for (record, name) in refs.iter().zip(names) {
        let actual: &[u8] = record.name.as_bstr().as_ref();
        assert!(actual == name.as_bytes());
    }
    assert_eq!(audit.ref_parse, 1);
    let mut output = [0; OUTPUT_BYTES];
    let tag_oid = ObjectId::from_hex(TAG_OID).unwrap();
    assert!(refs[REF_COUNT - 1].target() == tag_oid);
    let (kind, _) = loose_record(TAG, &tag_oid, &mut output, &mut audit).unwrap();
    assert_eq!(kind, gix_object::Kind::Tag);
}

#[test]
fn a02_ninth_ref_refuses_before_objects() {
    let names = [
        "refs/heads/a",
        "refs/heads/b",
        "refs/heads/c",
        "refs/heads/d",
        "refs/heads/e",
        "refs/heads/f",
        "refs/heads/g",
        "refs/heads/h",
        "refs/heads/i",
    ];
    let mut audit = Audit::default();
    assert!(matches!(
        packed_refs(refs_data(&names).as_bytes(), &mut audit),
        Err(Refusal::RefCount)
    ));
    assert_eq!(
        (
            audit.ref_parse,
            audit.payload_dispatch,
            audit.retained_bytes
        ),
        (1, 0, 0)
    );
}

#[test]
fn a03_oversized_ref_bytes_refuse_before_parse() {
    let fixture = Fixture::new("oversize");
    fs::write(fixture.0.join("packed-refs"), [b'x'; REF_BYTES + 1]).unwrap();
    let held = hold(&fixture.0).unwrap();
    let mut output = [0; REF_BYTES];
    assert_eq!(
        capture_refs(&held, &mut output, || panic!("capture started")),
        Err(Refusal::RefBytes)
    );
    assert!(output.iter().all(|byte| *byte == 0));
}

#[test]
fn a04_compressed_loose_record_fits() {
    let mut output = [0; OUTPUT_BYTES];
    let mut audit = Audit::default();
    let oid = expected_blob();
    let data = refs_data(&["refs/fixture/blob"]);
    assert!(packed_refs(data.as_bytes(), &mut audit).unwrap()[0].target() == oid);
    let (kind, blob) = loose_record(SMALL, &oid, &mut output, &mut audit).unwrap();
    assert_eq!(kind, gix_object::Kind::Blob);
    assert!(blob == b"bounded synthetic object\n");
    assert_eq!(audit.retained_bytes, blob.len());
}

#[test]
fn a05_declared_large_object_refuses_before_payload() {
    let mut output = [0; OUTPUT_BYTES];
    let mut audit = Audit::default();
    assert!(matches!(
        loose_record(LARGE, &expected_blob(), &mut output, &mut audit),
        Err(Refusal::DeclaredSize)
    ));
    assert_eq!((audit.payload_dispatch, audit.retained_bytes), (0, 0));
    assert_eq!(audit.max_output, HEADER_PREFIX);
    assert!(output.iter().all(|byte| *byte == 0));
}

#[test]
fn a06_false_small_header_cannot_expand_past_cap() {
    let mut output = [0; OUTPUT_BYTES];
    let mut audit = Audit::default();
    assert!(matches!(
        loose_record(FALSE_SMALL, &expected_blob(), &mut output, &mut audit),
        Err(Refusal::Expansion)
    ));
    assert_eq!((audit.payload_dispatch, audit.retained_bytes), (0, 0));
    assert_eq!(audit.max_output, HEADER_PREFIX);
    assert!(output.iter().all(|byte| *byte == 0));
}

#[test]
fn a07_replaced_root_never_reads_decoy() {
    let fixture = Fixture::new("replace");
    let current = fixture.0.join("current");
    let old = fixture.0.join("old");
    fs::create_dir(&current).unwrap();
    let data = refs_data(&["refs/heads/held"]);
    fs::write(current.join("packed-refs"), &data).unwrap();
    let held = hold(&current).unwrap();
    fs::rename(&current, &old).unwrap();
    fs::create_dir(&current).unwrap();
    fs::write(current.join("packed-refs"), b"synthetic decoy").unwrap();
    let mut output = [0; REF_BYTES];
    let size = capture_refs(&held, &mut output, || {}).unwrap();
    assert!(&output[..size] == data.as_bytes());
}

#[test]
fn a08_changed_leaf_refuses_before_scanner() {
    let fixture = Fixture::new("changed");
    let leaf = fixture.0.join("packed-refs");
    fs::write(&leaf, refs_data(&["refs/heads/held"])).unwrap();
    let held = hold(&fixture.0).unwrap();
    let mut output = [0; REF_BYTES];
    assert_eq!(
        capture_refs(&held, &mut output, || fs::write(
            &leaf,
            b"synthetic mutation"
        )
        .unwrap()),
        Err(Refusal::Changed),
    );
}

#[test]
fn a09_missing_packed_delta_capability_refuses() {
    let mut output = [0; OUTPUT_BYTES];
    let mut audit = Audit::default();
    assert_eq!(&PACK[..12], b"PACK\0\0\0\x02\0\0\0\x02");
    assert!(matches!(
        loose_record(PACK, &expected_blob(), &mut output, &mut audit),
        Err(Refusal::PackedUnsupported)
    ));
    assert_eq!((audit.payload_dispatch, audit.retained_bytes), (0, 0));
    assert!(output.iter().all(|byte| *byte == 0));
}
