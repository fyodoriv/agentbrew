use super::{
    DecompressorOxide, HASH, ObjectId, PACK, TINFL_FLAG_PARSE_ZLIB_HEADER,
    TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF, TINFLStatus, decompress,
};

const CAP: usize = 64;
const BASE_OID: &[u8] = b"f2d4cbf581ce33f85796fcf43626bec38582155f";
const RESULT_OID: &[u8] = b"011042944ca889d57c4afc2c2aa2eafa1b8f6a56";
const BASE_LEN: usize = 32;
const PROGRAM_LEN: usize = 6;

#[derive(Debug, PartialEq, Eq)]
enum Refusal {
    MissingBase,
    BaseIdentity,
    Size,
    Program,
}

fn inflate_fixture(compressed: &[u8], expected: usize) -> [u8; CAP] {
    let mut bytes = [0; CAP];
    let (status, consumed, written) = decompress(
        &mut DecompressorOxide::new(),
        compressed,
        &mut bytes,
        0,
        TINFL_FLAG_PARSE_ZLIB_HEADER | TINFL_FLAG_USING_NON_WRAPPING_OUTPUT_BUF,
    );
    assert_eq!(status, TINFLStatus::Done);
    assert_eq!(consumed, compressed.len());
    assert_eq!(written, expected);
    bytes
}

fn fixture() -> ([u8; CAP], [u8; CAP], ObjectId) {
    assert_eq!(PACK.len(), 80);
    let expected_base = ObjectId::from_hex(BASE_OID).expect("sealed base identity");
    assert_eq!(&PACK[26..46], expected_base.as_slice());
    (
        inflate_fixture(&PACK[14..25], BASE_LEN),
        inflate_fixture(&PACK[46..60], PROGRAM_LEN),
        expected_base,
    )
}

fn replay(
    base: Option<&[u8]>,
    expected_base: &ObjectId,
    program: &[u8],
    output: &mut [u8; CAP],
) -> Result<usize, Refusal> {
    output.fill(0);
    let result = replay_into(base, expected_base, program, output);
    if result.is_err() {
        output.fill(0);
    }
    result
}

// This fixture supports one-byte lengths, zero-offset copies and literal inserts.
fn replay_into(
    base: Option<&[u8]>,
    expected_base: &ObjectId,
    program: &[u8],
    output: &mut [u8; CAP],
) -> Result<usize, Refusal> {
    let base = base.ok_or(Refusal::MissingBase)?;
    if base.len() > CAP || program.len() > CAP {
        return Err(Refusal::Size);
    }
    let [base_len, result_len, operations @ ..] = program else {
        return Err(Refusal::Program);
    };
    let result_len = usize::from(*result_len);
    if usize::from(*base_len) != base.len() || result_len > CAP {
        return Err(Refusal::Size);
    }
    if gix_object::compute_hash(HASH, gix_object::Kind::Blob, base)
        .map_err(|_| Refusal::BaseIdentity)?
        != *expected_base
    {
        return Err(Refusal::BaseIdentity);
    }

    let mut pending = operations;
    let mut written = 0;
    while let Some((&opcode, tail)) = pending.split_first() {
        pending = tail;
        let bytes = match opcode {
            0x90 => {
                let (&length, tail) = pending.split_first().ok_or(Refusal::Program)?;
                pending = tail;
                if length == 0 {
                    return Err(Refusal::Program);
                }
                base.get(..usize::from(length)).ok_or(Refusal::Program)?
            }
            1..=0x7f => {
                let (literal, tail) = pending
                    .split_at_checked(usize::from(opcode))
                    .ok_or(Refusal::Program)?;
                pending = tail;
                literal
            }
            _ => return Err(Refusal::Program),
        };
        let end = written + bytes.len();
        if end > result_len {
            return Err(Refusal::Program);
        }
        output[written..end].copy_from_slice(bytes);
        written = end;
    }
    if written != result_len {
        return Err(Refusal::Program);
    }
    Ok(written)
}

#[test]
fn a10_sealed_delta_replays_to_exact_blob() {
    let (base, program, expected_base) = fixture();
    let mut output = [0; CAP];
    let len = replay(
        Some(&base[..BASE_LEN]),
        &expected_base,
        &program[..PROGRAM_LEN],
        &mut output,
    )
    .expect("sealed delta replay");
    assert_eq!(len, 33);
    assert_eq!(
        gix_object::compute_hash(HASH, gix_object::Kind::Blob, &output[..len])
            .expect("fixture result identity"),
        ObjectId::from_hex(RESULT_OID).expect("sealed result identity"),
    );
}

fn assert_refused(
    base: Option<&[u8]>,
    expected_base: &ObjectId,
    program: &[u8],
    expected: Refusal,
) {
    let mut output = [0x5a; CAP];
    assert_eq!(
        replay(base, expected_base, program, &mut output),
        Err(expected)
    );
    assert!(output.iter().all(|&byte| byte == 0));
}

#[test]
fn a11_missing_base_refuses() {
    let (_, program, expected) = fixture();
    assert_refused(
        None,
        &expected,
        &program[..PROGRAM_LEN],
        Refusal::MissingBase,
    );
}

#[test]
fn a12_declared_output_cap_precedes_replay() {
    let (base, mut program, expected) = fixture();
    program[1] = 65;
    program[2] = 0;
    assert_refused(
        Some(&base[..BASE_LEN]),
        &expected,
        &program[..PROGRAM_LEN],
        Refusal::Size,
    );
}

#[test]
fn a13_truncated_literal_discards_partial_output() {
    let (base, program, expected) = fixture();
    assert_refused(
        Some(&base[..BASE_LEN]),
        &expected,
        &program[..PROGRAM_LEN - 1],
        Refusal::Program,
    );
}

#[test]
fn a14_wrong_base_identity_refuses() {
    let (mut base, program, expected) = fixture();
    base[0] ^= 1;
    assert_refused(
        Some(&base[..BASE_LEN]),
        &expected,
        &program[..PROGRAM_LEN],
        Refusal::BaseIdentity,
    );
}
