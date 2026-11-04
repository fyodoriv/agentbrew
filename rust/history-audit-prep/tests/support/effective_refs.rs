use super::{
    Audit, OUTPUT_BYTES, ObjectId, REF_COUNT, SMALL, SMALL_OID, TAG, TAG_OID, loose_record,
    packed_delta_slice, packed_refs,
};
use gix_object::{Kind, bstr::ByteSlice};
use gix_ref::FullNameRef;

const PACKED_RESULT: &[u8] = packed_delta_slice::RESULT_OID;
const LOOSE_NAME_BYTES: usize = 128;
const SHA1_HEX_BYTES: usize = 40;
const UNAVAILABLE: &[u8] = b"1111111111111111111111111111111111111111";

#[derive(Debug, PartialEq, Eq)]
enum Refusal {
    RefCount,
    RefEncoding,
    RefBytes,
    Duplicate,
    Symbolic,
    MissingObject,
    ObjectIntegrity,
}

struct LooseRef<'a> {
    name: &'a [u8],
    value: &'a [u8],
}

#[derive(Debug, PartialEq, Eq)]
struct Verified<'a> {
    name: &'a [u8],
    target: ObjectId,
    kind: Kind,
}

#[derive(Debug, Default, PartialEq, Eq)]
struct Reads {
    attempted: usize,
    verified: usize,
}

struct Resolved<'a> {
    name: &'a [u8],
    target: ObjectId,
    loose: bool,
}

fn insert<'a>(
    effective: &mut [Option<Resolved<'a>>; REF_COUNT],
    candidate: Resolved<'a>,
) -> Result<(), Refusal> {
    let slot = effective
        .iter_mut()
        .find(|row| row.as_ref().is_none_or(|row| row.name == candidate.name))
        .ok_or(Refusal::RefCount)?;
    // A loose ref can replace a packed ref once. Duplicates within either source fail.
    if slot
        .as_ref()
        .is_some_and(|row| row.loose || !candidate.loose)
    {
        return Err(Refusal::Duplicate);
    }
    *slot = Some(candidate);
    Ok(())
}

fn decode_loose_ref(value: &[u8]) -> Result<ObjectId, Refusal> {
    if value.len() > SHA1_HEX_BYTES + 1 {
        return Err(Refusal::RefEncoding);
    }
    if value.starts_with(b"ref: ") {
        return Err(Refusal::Symbolic);
    }
    let hex = value.strip_suffix(b"\n").ok_or(Refusal::RefEncoding)?;
    if hex.len() != SHA1_HEX_BYTES {
        return Err(Refusal::RefEncoding);
    }
    ObjectId::from_hex(hex).map_err(|_| Refusal::RefEncoding)
}

fn read_object(target: &ObjectId, reads: &mut Reads) -> Result<Kind, Refusal> {
    reads.attempted += 1;
    let kind = if *target == oid(PACKED_RESULT) {
        packed_delta_slice::verified_fixture_blob(target).ok_or(Refusal::ObjectIntegrity)?;
        Kind::Blob
    } else {
        let compressed = if *target == oid(SMALL_OID) {
            SMALL
        } else if *target == oid(TAG_OID) {
            TAG
        } else {
            return Err(Refusal::MissingObject);
        };
        let mut output = [0; OUTPUT_BYTES];
        loose_record(compressed, target, &mut output, &mut Audit::default())
            .map_err(|_| Refusal::ObjectIntegrity)?
            .0
    };
    reads.verified += 1;
    Ok(kind)
}

fn compose<'a>(
    packed: &'a [u8],
    loose: &[LooseRef<'a>],
    reads: &mut Reads,
) -> Result<[Option<Verified<'a>>; REF_COUNT], Refusal> {
    if loose.len() > REF_COUNT {
        return Err(Refusal::RefCount);
    }
    let packed = packed_refs(packed, &mut Audit::default()).map_err(|reason| match reason {
        super::Refusal::RefCount => Refusal::RefCount,
        super::Refusal::RefBytes => Refusal::RefBytes,
        _ => Refusal::RefEncoding,
    })?;
    if packed.len() + loose.len() > REF_COUNT {
        return Err(Refusal::RefCount);
    }

    let mut effective = std::array::from_fn(|_| None);
    for record in packed {
        let name: &[u8] = record.name.as_bstr().as_ref();
        if !name.starts_with(b"refs/") {
            return Err(Refusal::RefEncoding);
        }
        insert(
            &mut effective,
            Resolved {
                name,
                target: record.target(),
                loose: false,
            },
        )?;
    }
    for record in loose {
        if record.name.len() > LOOSE_NAME_BYTES || !record.name.starts_with(b"refs/") {
            return Err(Refusal::RefEncoding);
        }
        let _: &FullNameRef = record
            .name
            .as_bstr()
            .try_into()
            .map_err(|_| Refusal::RefEncoding)?;
        insert(
            &mut effective,
            Resolved {
                name: record.name,
                target: decode_loose_ref(record.value)?,
                loose: true,
            },
        )?;
    }

    let mut verified = std::array::from_fn(|_| None);
    for (slot, record) in verified.iter_mut().zip(effective.into_iter().flatten()) {
        let kind = read_object(&record.target, reads)?;
        *slot = Some(Verified {
            name: record.name,
            target: record.target,
            kind,
        });
    }
    Ok(verified)
}

fn packed_rows(rows: &[(&str, &[u8])]) -> String {
    rows.iter()
        .map(|(name, oid)| format!("{} {name}\n", std::str::from_utf8(oid).unwrap()))
        .collect()
}

fn loose_value(oid: &[u8]) -> [u8; 41] {
    let mut line = [b'\n'; 41];
    line[..40].copy_from_slice(oid);
    line
}

fn oid(bytes: &[u8]) -> ObjectId {
    ObjectId::from_hex(bytes).expect("sealed object identity")
}

#[test]
fn a15_effective_refs_reach_both_object_readers() {
    let packed = packed_rows(&[
        ("refs/fixture/override", UNAVAILABLE),
        ("refs/other/packed-only", SMALL_OID),
        ("refs/tags/annotated", TAG_OID),
    ]);
    let loose = [
        LooseRef {
            name: b"refs/fixture/override",
            value: &loose_value(PACKED_RESULT),
        },
        LooseRef {
            name: b"refs/other/loose-only",
            value: &loose_value(SMALL_OID),
        },
    ];
    let mut reads = Reads::default();
    let effective = compose(packed.as_bytes(), &loose, &mut reads).expect("sealed effective refs");
    let expected: &[(&[u8], &[u8], Kind)] = &[
        (b"refs/fixture/override", PACKED_RESULT, Kind::Blob),
        (b"refs/other/packed-only", SMALL_OID, Kind::Blob),
        (b"refs/tags/annotated", TAG_OID, Kind::Tag),
        (b"refs/other/loose-only", SMALL_OID, Kind::Blob),
    ];
    assert_eq!(effective.iter().flatten().count(), expected.len());
    for &(name, target, kind) in expected {
        assert!(
            effective.iter().flatten().any(|item| {
                item.name == name && item.target == oid(target) && item.kind == kind
            })
        );
    }
    assert_eq!(
        reads,
        Reads {
            attempted: 4,
            verified: 4
        }
    );
}

fn refused_before_read(packed: &str, loose: &[LooseRef<'_>], expected: Refusal) {
    let mut reads = Reads::default();
    assert_eq!(compose(packed.as_bytes(), loose, &mut reads), Err(expected));
    assert_eq!(reads, Reads::default());
}

#[test]
fn a16_physical_cap_counts_shadowed_rows() {
    let packed = super::refs_data(&[
        "refs/fixture/a",
        "refs/fixture/b",
        "refs/fixture/c",
        "refs/fixture/d",
        "refs/fixture/e",
        "refs/fixture/f",
        "refs/fixture/g",
        "refs/fixture/h",
    ]);
    refused_before_read(
        &packed,
        &[LooseRef {
            name: b"refs/fixture/a",
            value: &loose_value(SMALL_OID),
        }],
        Refusal::RefCount,
    );
}

#[test]
fn a17_invalid_loose_ref_does_not_use_packed_fallback() {
    let packed = packed_rows(&[("refs/fixture/override", SMALL_OID)]);
    let mut long_name = [b'x'; 129];
    long_name[..5].copy_from_slice(b"refs/");
    for (name, value) in [
        (b"refs/fixture/override".as_slice(), b"broken\n".as_slice()),
        (b"refs/fixture/override", &[b'x'; 42]),
        (
            b"refs/fixture/override",
            &loose_value(UNAVAILABLE).map(|byte| if byte == b'1' { b'g' } else { byte }),
        ),
        (b"refs/fixture/../bad", &loose_value(SMALL_OID)),
        (&long_name, &loose_value(SMALL_OID)),
    ] {
        refused_before_read(&packed, &[LooseRef { name, value }], Refusal::RefEncoding);
    }
}

#[test]
fn a18_duplicates_in_either_source_refuse() {
    let packed = packed_rows(&[
        ("refs/fixture/duplicate", SMALL_OID),
        ("refs/fixture/duplicate", PACKED_RESULT),
    ]);
    refused_before_read(&packed, &[], Refusal::Duplicate);

    let loose = [
        LooseRef {
            name: b"refs/fixture/duplicate",
            value: &loose_value(SMALL_OID),
        },
        LooseRef {
            name: b"refs/fixture/duplicate",
            value: &loose_value(PACKED_RESULT),
        },
    ];
    refused_before_read(
        &packed_rows(&[("refs/fixture/duplicate", SMALL_OID)]),
        &loose,
        Refusal::Duplicate,
    );
}

#[test]
fn a19_symbolic_override_does_not_use_packed_fallback() {
    let packed = packed_rows(&[("refs/fixture/override", SMALL_OID)]);
    refused_before_read(
        &packed,
        &[LooseRef {
            name: b"refs/fixture/override",
            value: b"ref: refs/fixture/other\n",
        }],
        Refusal::Symbolic,
    );
}

#[test]
fn a20_missing_object_does_not_publish_partial_set() {
    let packed = packed_rows(&[
        ("refs/fixture/a", SMALL_OID),
        ("refs/fixture/b", UNAVAILABLE),
    ]);
    let mut reads = Reads::default();
    assert_eq!(
        compose(packed.as_bytes(), &[], &mut reads),
        Err(Refusal::MissingObject)
    );
    assert_eq!(
        reads,
        Reads {
            attempted: 2,
            verified: 1
        }
    );
}
