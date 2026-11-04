use gdoc_capture::{capture, Command, Output, Owner, Reply, Stop};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
type OpenBarrier = (mpsc::Sender<()>, mpsc::Receiver<()>);

#[derive(Clone, Copy, PartialEq, Eq)]
enum Fault {
    None,
    Stall,
    Interrupt,
    Terminate,
    Operation,
    Missing,
    Old,
    Repeat,
    Invalid,
    Empty,
    CloseUnknown,
    ChildUnknown,
    OpenUnknown,
}

#[derive(Default)]
struct Trace {
    actions: Vec<(&'static str, String, String, u8)>,
    outputs: Vec<(&'static str, String, u8)>,
    live: Vec<(String, String)>,
    recovery: Vec<(String, String)>,
}

type Shared = Arc<Mutex<Trace>>;

struct Fake {
    fault: Fault,
    trace: Shared,
    page: u8,
    clock: u64,
    opened: Option<OpenBarrier>,
}
impl Owner for Fake {
    fn qualify(&mut self) -> Result<(), Stop> {
        match self.fault {
            Fault::Missing => Err(Stop::MissingOwner),
            Fault::Old => Err(Stop::UnqualifiedOwner),
            _ => Ok(()),
        }
    }
    fn now_ms(&self) -> u64 {
        self.clock
    }
    fn call(&mut self, command: Command<'_>, deadline: u64) -> Result<Reply, Stop> {
        assert!(deadline > self.clock);
        let (kind, owner, target, page) = match command {
            Command::Open { owner, lease_secs } => {
                assert_eq!(lease_secs, 300);
                assert_eq!(deadline - self.clock, 25_000);
                ("open", owner, "", 0)
            }
            Command::Position {
                owner,
                target,
                page,
            } => ("position", owner, target, page),
            Command::Observe { owner, target } => ("observe", owner, target, self.page),
            Command::Shot { owner, target } => ("shot", owner, target, self.page),
            Command::CloseVerified { owner, target } => {
                ("verified-close", owner, target, self.page)
            }
        };
        if kind != "open" {
            assert!(deadline - self.clock <= 20_000);
        }
        self.trace
            .lock()
            .unwrap()
            .actions
            .push((kind, owner.into(), target.into(), page));
        self.clock += 1;
        if kind == "open" {
            if self.fault == Fault::OpenUnknown {
                return Err(Stop::OpenUnknown);
            }
            let target = format!("tab-{owner}");
            self.trace
                .lock()
                .unwrap()
                .live
                .push((owner.into(), target.clone()));
            if let Some((send, receive)) = &self.opened {
                send.send(()).unwrap();
                receive.recv_timeout(Duration::from_secs(2)).unwrap();
            }
            return Ok(Reply::Opened(target));
        }
        let expected = (owner.to_owned(), target.to_owned());
        assert!(self.trace.lock().unwrap().live.contains(&expected));
        assert_ne!(owner, "sentinel");
        if kind == "verified-close" {
            if self.fault == Fault::CloseUnknown {
                return Err(Stop::CloseUnknown);
            }
            self.trace
                .lock()
                .unwrap()
                .live
                .retain(|pair| pair != &expected);
            return Ok(Reply::Closed);
        }
        if kind == "position" {
            if page == 5 {
                match self.fault {
                    Fault::Stall => {
                        self.clock = deadline;
                        return Err(Stop::Deadline);
                    }
                    Fault::Interrupt => return Err(Stop::Interrupt),
                    Fault::Terminate => return Err(Stop::Terminate),
                    Fault::Operation => return Err(Stop::Operation),
                    Fault::ChildUnknown => return Err(Stop::ChildUnknown),
                    _ => {}
                }
            }
            self.page = page;
        }
        if kind == "shot" {
            assert!(self.trace.lock().unwrap().recovery.contains(&expected));
            return Ok(Reply::Image(match (page, self.fault) {
                (5, Fault::Invalid) => b"not a PNG".to_vec(),
                (5, Fault::Empty) => vec![],
                _ => image(page),
            }));
        }
        Ok(Reply::Layout {
            page: if self.fault == Fault::Repeat && page == 5 {
                4
            } else {
                page
            },
            settled: true,
        })
    }
}
fn image(page: u8) -> Vec<u8> {
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, 1, 1);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .unwrap()
            .write_image_data(&[page, 42, 0])
            .unwrap();
    }
    bytes
}

struct Sink {
    trace: Shared,
    run: String,
}
impl Output for Sink {
    fn prepare(&mut self, run: &str) -> Result<(), Stop> {
        assert_eq!(run, self.run);
        self.trace
            .lock()
            .unwrap()
            .outputs
            .push(("prepare", run.into(), 0));
        Ok(())
    }
    fn remember(&mut self, owner: &str, target: &str) -> Result<(), Stop> {
        self.trace
            .lock()
            .unwrap()
            .recovery
            .push((owner.into(), target.into()));
        Ok(())
    }
    fn save(&mut self, page: u8, image_bytes: &[u8]) -> Result<(), Stop> {
        assert_eq!(image_bytes, image(page));
        self.trace
            .lock()
            .unwrap()
            .outputs
            .push(("save", self.run.clone(), page));
        Ok(())
    }
    fn clear_recovery(&mut self) -> Result<(), Stop> {
        self.trace
            .lock()
            .unwrap()
            .recovery
            .retain(|(owner, _)| owner != &self.run);
        Ok(())
    }
    fn publish(&mut self, pages: u8) -> Result<(), Stop> {
        assert!(!self
            .trace
            .lock()
            .unwrap()
            .live
            .iter()
            .any(|(owner, _)| owner == &self.run));
        self.trace
            .lock()
            .unwrap()
            .outputs
            .push(("publish", self.run.clone(), pages));
        Ok(())
    }
}
fn fixture() -> Shared {
    Arc::new(Mutex::new(Trace {
        live: vec![("sentinel".into(), "foreign-target".into())],
        ..Trace::default()
    }))
}
fn run(trace: &Shared, fault: Fault, id: &str, opened: Option<OpenBarrier>) -> Result<(), Stop> {
    let mut fake = Fake {
        fault,
        trace: trace.clone(),
        page: 0,
        clock: 0,
        opened,
    };
    let mut sink = Sink {
        trace: trace.clone(),
        run: id.into(),
    };
    capture(&mut fake, &mut sink, id)
}
fn assert_run(fault: Fault, result: Result<(), Stop>, saved: u8, close: usize, retained: bool) {
    let trace = fixture();
    let observed = run(&trace, fault, "run-a", None);
    assert_eq!(observed, result);
    let trace = trace.lock().unwrap();
    assert!(trace
        .live
        .contains(&("sentinel".into(), "foreign-target".into())));
    assert_eq!(
        trace
            .actions
            .iter()
            .filter(|v| v.0 == "verified-close")
            .count(),
        close
    );
    assert_eq!(
        trace
            .outputs
            .iter()
            .filter(|v| v.0 == "save")
            .map(|v| v.2)
            .collect::<Vec<_>>(),
        (1..=saved).collect::<Vec<_>>()
    );
    assert_eq!(
        trace.outputs.iter().filter(|v| v.0 == "publish").count(),
        usize::from(result.is_ok())
    );
    assert_eq!(
        trace.recovery,
        if retained {
            vec![("run-a".into(), "tab-run-a".into())]
        } else {
            vec![]
        }
    );
    if matches!(fault, Fault::Missing | Fault::Old) {
        assert!(trace.actions.is_empty() && trace.outputs.is_empty());
    }
    if result.is_ok() {
        let actions = &trace.actions;
        assert_eq!(actions.len(), 42);
        for (page, four) in (1..=10).zip(actions[1..41].chunks_exact(4)) {
            assert_eq!(
                four.iter()
                    .map(|v| (v.0, v.2.as_str(), v.3))
                    .collect::<Vec<_>>(),
                vec![
                    ("position", "tab-run-a", page),
                    ("observe", "tab-run-a", page),
                    ("shot", "tab-run-a", page),
                    ("observe", "tab-run-a", page)
                ]
            );
        }
    }
}
macro_rules! case {
    ($name:ident,$fault:ident,$result:expr,$saved:expr,$close:expr,$retained:expr) => {
        #[test]
        fn $name() {
            assert_run(Fault::$fault, $result, $saved, $close, $retained);
        }
    };
}
case!(c01, None, Ok(()), 10, 1, false);
case!(c02, Stall, Err(Stop::Deadline), 4, 1, false);
case!(c03_int, Interrupt, Err(Stop::Interrupt), 4, 1, false);
case!(c03_term, Terminate, Err(Stop::Terminate), 4, 1, false);
case!(c04, Operation, Err(Stop::Operation), 4, 1, false);
#[test]
fn c05() {
    let trace = fixture();
    let (send_a, receive_a) = mpsc::channel();
    let (send_b, receive_b) = mpsc::channel();
    std::thread::scope(|scope| {
        let a = scope.spawn({
            let trace = &trace;
            move || run(trace, Fault::None, "run-a", Some((send_a, receive_b)))
        });
        let b = scope.spawn({
            let trace = &trace;
            move || run(trace, Fault::None, "run-b", Some((send_b, receive_a)))
        });
        assert_eq!(a.join().unwrap(), Ok(()));
        assert_eq!(b.join().unwrap(), Ok(()));
    });
    let trace = trace.lock().unwrap();
    assert_eq!(
        trace.live,
        vec![("sentinel".into(), "foreign-target".into())]
    );
    assert_eq!(trace.actions[0].0, "open");
    assert_eq!(trace.actions[1].0, "open");
    let mut publications: Vec<_> = trace
        .outputs
        .iter()
        .filter(|v| v.0 == "publish")
        .cloned()
        .collect();
    publications.sort();
    assert_eq!(
        publications,
        vec![
            ("publish", "run-a".into(), 10),
            ("publish", "run-b".into(), 10)
        ]
    );
    assert!(trace.recovery.is_empty());
}
case!(c06_missing, Missing, Err(Stop::MissingOwner), 0, 0, false);
case!(c06_old, Old, Err(Stop::UnqualifiedOwner), 0, 0, false);
case!(c07_repeat, Repeat, Err(Stop::PageIdentity), 4, 1, false);
case!(c07_invalid, Invalid, Err(Stop::InvalidPng), 4, 1, false);
case!(c07_empty, Empty, Err(Stop::InvalidPng), 4, 1, false);
case!(
    c08_unverified,
    CloseUnknown,
    Err(Stop::CloseUnknown),
    10,
    1,
    true
);
case!(
    c08_child_unknown,
    ChildUnknown,
    Err(Stop::ChildUnknown),
    4,
    0,
    true
);
case!(
    c08_open_unknown,
    OpenUnknown,
    Err(Stop::OpenUnknown),
    0,
    0,
    false
);
