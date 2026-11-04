#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stop {
    MissingOwner,
    UnqualifiedOwner,
    Deadline,
    Interrupt,
    Terminate,
    Operation,
    PageIdentity,
    InvalidPng,
    CloseUnknown,
    ChildUnknown,
    OpenUnknown,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Command<'a> {
    Open {
        owner: &'a str,
        lease_secs: u32,
    },
    Position {
        owner: &'a str,
        target: &'a str,
        page: u8,
    },
    Observe {
        owner: &'a str,
        target: &'a str,
    },
    Shot {
        owner: &'a str,
        target: &'a str,
    },
    CloseVerified {
        owner: &'a str,
        target: &'a str,
    },
}

pub enum Reply {
    Opened(String),
    Layout { page: u8, settled: bool },
    Image(Vec<u8>),
    Closed,
}

pub trait Owner {
    fn qualify(&mut self) -> Result<(), Stop>;
    fn now_ms(&self) -> u64;
    /// Report ChildUnknown if the command may still run. Other operation
    /// outcomes must carry terminal proof from the process owner.
    fn call(&mut self, command: Command<'_>, deadline_ms: u64) -> Result<Reply, Stop>;
}

pub trait Output {
    fn prepare(&mut self, run: &str) -> Result<(), Stop>;
    fn remember(&mut self, owner: &str, target: &str) -> Result<(), Stop>;
    fn save(&mut self, page: u8, image: &[u8]) -> Result<(), Stop>;
    fn clear_recovery(&mut self) -> Result<(), Stop>;
    fn publish(&mut self, pages: u8) -> Result<(), Stop>;
}

const OPEN_MS: u64 = 25_000;
const OPERATION_MS: u64 = 20_000;
const CAPTURE_MS: u64 = 180_000;
const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;
const PAGES: u8 = 10;

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn bounded(owner: &mut impl Owner, command: Command<'_>, capture_end: u64) -> Result<Reply, Stop> {
    let now = owner.now_ms();
    let end = capture_end.min(now.saturating_add(OPERATION_MS));
    if end <= now {
        return Err(Stop::Deadline);
    }
    // Any successful port response carries terminal child proof.
    let response = owner.call(command, end)?;
    if owner.now_ms() >= end {
        return Err(Stop::Deadline);
    }
    Ok(response)
}

fn observe(
    owner: &mut impl Owner,
    run: &str,
    target: &str,
    page: u8,
    end: u64,
) -> Result<(), Stop> {
    match bounded(owner, Command::Observe { owner: run, target }, end)? {
        Reply::Layout {
            page: seen,
            settled: true,
        } if seen == page => Ok(()),
        _ => Err(Stop::PageIdentity),
    }
}

#[derive(PartialEq, Eq)]
struct Pixels {
    width: u32,
    height: u32,
    color: png::ColorType,
    depth: png::BitDepth,
    data: Vec<u8>,
}

fn decode(image: &[u8]) -> Result<Pixels, Stop> {
    if image.is_empty() || image.len() > MAX_IMAGE_BYTES {
        return Err(Stop::InvalidPng);
    }
    let mut decoder = png::Decoder::new_with_limits(
        std::io::Cursor::new(image),
        png::Limits {
            bytes: MAX_IMAGE_BYTES,
        },
    );
    decoder.set_ignore_text_chunk(true);
    decoder.set_ignore_iccp_chunk(true);
    let mut reader = decoder.read_info().map_err(|_| Stop::InvalidPng)?;
    if reader.info().animation_control.is_some() {
        return Err(Stop::InvalidPng);
    }
    let size = reader
        .output_buffer_size()
        .filter(|size| *size <= MAX_IMAGE_BYTES)
        .ok_or(Stop::InvalidPng)?;
    let mut data = vec![0; size];
    let frame = reader.next_frame(&mut data).map_err(|_| Stop::InvalidPng)?;
    reader.finish().map_err(|_| Stop::InvalidPng)?;
    data.truncate(frame.buffer_size());
    Ok(Pixels {
        width: frame.width,
        height: frame.height,
        color: frame.color_type,
        depth: frame.bit_depth,
        data,
    })
}

fn pages(
    owner: &mut impl Owner,
    output: &mut impl Output,
    run: &str,
    target: &str,
    end: u64,
) -> Result<(), Stop> {
    let mut prior = Vec::new();
    for page in 1..=PAGES {
        if !matches!(
            bounded(
                owner,
                Command::Position {
                    owner: run,
                    target,
                    page
                },
                end
            )?,
            Reply::Layout { .. }
        ) {
            return Err(Stop::Operation);
        }
        observe(owner, run, target, page, end)?;
        let Reply::Image(image) = bounded(owner, Command::Shot { owner: run, target }, end)? else {
            return Err(Stop::InvalidPng);
        };
        observe(owner, run, target, page, end)?;
        let pixels = decode(&image)?;
        if prior.contains(&pixels) {
            return Err(Stop::InvalidPng);
        }
        output.save(page, &image)?;
        prior.push(pixels);
    }
    if owner.now_ms() >= end {
        return Err(Stop::Deadline);
    }
    Ok(())
}

pub fn capture(owner: &mut impl Owner, output: &mut impl Output, run: &str) -> Result<(), Stop> {
    owner.qualify()?;
    if !valid_id(run) {
        return Err(Stop::Operation);
    }
    output.prepare(run)?;
    let start = owner.now_ms();
    let open_end = start.saturating_add(OPEN_MS);
    if open_end <= start {
        return Err(Stop::Deadline);
    }
    let Reply::Opened(target) = owner.call(
        Command::Open {
            owner: run,
            lease_secs: 300,
        },
        open_end,
    )?
    else {
        return Err(Stop::OpenUnknown);
    };
    if !valid_id(&target) {
        return Err(Stop::OpenUnknown);
    }

    let opened_late = owner.now_ms() >= open_end;
    let captured = output.remember(run, &target).and_then(|()| {
        if opened_late {
            return Err(Stop::Deadline);
        }
        pages(
            owner,
            output,
            run,
            &target,
            start.saturating_add(CAPTURE_MS),
        )
    });
    if captured == Err(Stop::ChildUnknown) {
        return captured;
    }
    if !matches!(
        bounded(
            owner,
            Command::CloseVerified {
                owner: run,
                target: &target
            },
            u64::MAX
        ),
        Ok(Reply::Closed)
    ) {
        return Err(Stop::CloseUnknown);
    }
    output.clear_recovery()?;
    captured?;
    output.publish(PAGES)
}

pub mod output;
pub mod wire;
