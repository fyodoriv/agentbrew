#![forbid(unsafe_code)]

#[path = "../src/page_errors.rs"]
mod reducer;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::io;
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::{protocol::WebSocketConfig, Message};
use tokio_tungstenite::{accept_async_with_config, client_async_with_config, WebSocketStream};

const WIRE_LIMIT: usize = 65_536;
const HANDSHAKE: Duration = Duration::from_secs(2);
const READINESS: Duration = Duration::from_secs(2);
const CLEANUP: Duration = Duration::from_secs(2);
const FIXTURE: Duration = Duration::from_secs(10);
const FIXTURE_URL: &str = "ws://fixture.example/probe";

struct HandshakeStream {
    stream: TcpStream,
    remaining: Option<usize>,
}

impl HandshakeStream {
    fn new(stream: TcpStream) -> Self {
        Self {
            stream,
            remaining: Some(WIRE_LIMIT),
        }
    }
}

impl AsyncRead for HandshakeStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        output: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let Some(remaining) = self.remaining else {
            return Pin::new(&mut self.stream).poll_read(cx, output);
        };
        if output.remaining() == 0 {
            return Poll::Ready(Ok(()));
        }
        if remaining == 0 {
            return Poll::Ready(Err(io::ErrorKind::InvalidData.into()));
        }
        let len = remaining.min(output.remaining());
        let mut bounded = ReadBuf::new(output.initialize_unfilled_to(len));
        match Pin::new(&mut self.stream).poll_read(cx, &mut bounded) {
            Poll::Ready(Ok(())) => {
                let read = bounded.filled().len();
                output.advance(read);
                self.remaining = Some(remaining - read);
                Poll::Ready(Ok(()))
            }
            result => result,
        }
    }
}

impl AsyncWrite for HandshakeStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        data: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.stream).poll_write(cx, data)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_shutdown(cx)
    }
}

fn config() -> WebSocketConfig {
    WebSocketConfig::default()
        .read_buffer_size(4096)
        .write_buffer_size(0)
        .max_write_buffer_size(WIRE_LIMIT)
        .max_frame_size(Some(WIRE_LIMIT))
        .max_message_size(Some(WIRE_LIMIT))
}

type Wire = WebSocketStream<HandshakeStream>;

async fn send(wire: &mut Wire, message: Value) {
    timeout(
        READINESS,
        wire.send(Message::Text(message.to_string().into())),
    )
    .await
    .expect("fixture send deadline")
    .expect("fixture send");
}

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .enable_io()
        .enable_time()
        .build()
        .expect("fixture runtime")
}

async fn fixture_listener() -> TcpListener {
    TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("owned loopback listener")
}

async fn peer_wire(listener: TcpListener) -> Wire {
    let (stream, _) = timeout(HANDSHAKE, listener.accept())
        .await
        .expect("fixture accept deadline")
        .expect("fixture accept");
    let mut wire = timeout(
        HANDSHAKE,
        accept_async_with_config(
            HandshakeStream::new(stream),
            Some(config().max_write_buffer_size(WIRE_LIMIT + 4096)),
        ),
    )
    .await
    .expect("fixture handshake deadline")
    .expect("fixture handshake");
    wire.get_mut().remaining = None;
    wire
}

async fn client_wire(address: std::net::SocketAddr) -> Wire {
    assert!(address.ip().is_loopback() && address.port() != 0);
    let stream = timeout(HANDSHAKE, TcpStream::connect(address))
        .await
        .expect("fixture connect deadline")
        .expect("fixture connect");
    let (mut wire, _) = timeout(
        HANDSHAKE,
        client_async_with_config(FIXTURE_URL, HandshakeStream::new(stream), Some(config())),
    )
    .await
    .expect("fixture client handshake deadline")
    .expect("fixture client handshake");
    wire.get_mut().remaining = None;
    wire
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Case {
    Empty,
    Errors,
    Ongoing,
    OngoingError,
    AckError,
    AckLate,
    AckWrong,
    Disconnect,
    FrameOverflow,
    FragmentOverflow,
    EventOverflow,
    Foreign,
    Malformed,
    Duplicate,
    Cancel,
    Hold,
    BadClose,
    ClosePresent,
}

fn event(session: &str, method: &str, params: Value) -> Value {
    json!({"sessionId":session,"method":method,"params":params})
}

fn request_event(session: &str, request: &str) -> Value {
    event(
        session,
        "Network.requestWillBeSent",
        json!({"requestId":request,"request":{
            "url":"https://fixture.example/private-fixture-marker",
            "headers":{"x-private":"private-fixture-marker"},"postData":"private-fixture-marker"
        }}),
    )
}

fn console() -> Value {
    event(
        "root",
        "Runtime.consoleAPICalled",
        json!({"type":"error","args":[{"value":"private-fixture-marker"}]}),
    )
}

fn command(id: u8, method: &str, session: &str) -> Value {
    json!({"id":id,"method":method,"sessionId":session})
}

fn reply(id: u8, session: &str) -> Value {
    json!({"id":id,"result":{},"sessionId":session})
}

async fn expect_command(wire: &mut Wire, expected: Value) {
    match timeout(FIXTURE, wire.next()).await {
        Ok(Some(Ok(Message::Text(text)))) => {
            assert_eq!(
                serde_json::from_slice::<Value>(text.as_bytes()).unwrap(),
                expected
            );
        }
        _ => panic!("missing expected fixture command"),
    }
}

async fn send_raw(wire: &mut Wire, raw: Message) {
    timeout(READINESS, wire.send(raw))
        .await
        .expect("fixture send deadline")
        .expect("fixture send");
}

async fn peer(listener: TcpListener, case: Case, cancel: oneshot::Sender<()>) {
    use tokio_tungstenite::tungstenite::protocol::frame::{
        coding::{Data, OpCode},
        Frame,
    };
    let mut wire = peer_wire(listener).await;
    expect_command(&mut wire, command(1, "Runtime.enable", "root")).await;
    match case {
        Case::AckError => {
            send(
                &mut wire,
                json!({"id":1,"error":{"code":-1},"sessionId":"root"}),
            )
            .await
        }
        Case::AckWrong => send(&mut wire, reply(99, "root")).await,
        Case::AckLate => {}
        Case::Disconnect => return,
        _ => {
            send(&mut wire, reply(1, "root")).await;
            expect_command(&mut wire, command(2, "Network.enable", "root")).await;
            send(&mut wire, reply(2, "root")).await;
            if case == Case::Errors {
                send(&mut wire, json!({"fixture_related":{"parent":"root","session":"child","target":"owned-child"}})).await;
                expect_command(&mut wire, command(3, "Runtime.enable", "child")).await;
                send(&mut wire, reply(3, "child")).await;
                expect_command(&mut wire, command(4, "Network.enable", "child")).await;
                send(&mut wire, reply(4, "child")).await;
                expect_command(
                    &mut wire,
                    command(5, "Runtime.runIfWaitingForDebugger", "child"),
                )
                .await;
                send(&mut wire, reply(5, "child")).await;
            } else if case == Case::Foreign {
                send(&mut wire, json!({"fixture_related":{"parent":"sentinel","session":"foreign","target":"unknown"}})).await;
            } else {
                send(&mut wire, json!({"fixture_related":null})).await;
            }
            if case != Case::Foreign {
                expect_command(&mut wire, command(6, "Page.navigate", "root")).await;
                send(&mut wire, reply(6, "root")).await;
                expect_command(&mut wire, command(7, "Runtime.evaluate", "root")).await;
                if case != Case::EventOverflow {
                    send(&mut wire, reply(7, "root")).await;
                }
                match case {
                    Case::Errors => {
                        send(&mut wire, console()).await;
                        send(&mut wire, event("child", "Runtime.exceptionThrown", json!({"exceptionDetails":{"text":"fixture exception"}}))).await;
                        for session in ["root","child"] {
                            send(&mut wire, request_event(session, "shared")).await;
                        }
                        for (session, status) in [("root",404),("child",503)] {
                            send(&mut wire, event(session, "Network.responseReceived", json!({"requestId":"shared","response":{"status":status}}))).await;
                            send(&mut wire, event(session, "Network.loadingFinished", json!({"requestId":"shared"}))).await;
                        }
                    }
                    Case::Ongoing | Case::OngoingError => {
                        for name in ["poll","sse"] {
                            send(&mut wire, request_event("root", name)).await;
                        }
                        if case == Case::OngoingError {
                            send(&mut wire, console()).await;
                        }
                    }
                    Case::FrameOverflow => {
                        send_raw(&mut wire, Message::Text("x".repeat(WIRE_LIMIT + 1).into())).await;
                        return;
                    }
                    Case::FragmentOverflow => {
                        send_raw(&mut wire, Message::Frame(Frame::message(
                            vec![b'x'; WIRE_LIMIT / 2], OpCode::Data(Data::Text), false,
                        ))).await;
                        send_raw(&mut wire, Message::Frame(Frame::message(
                            vec![b'x'; WIRE_LIMIT / 2 + 1], OpCode::Data(Data::Continue), true,
                        ))).await;
                        return;
                    }
                    Case::EventOverflow => {
                        for _ in 0..1025 {
                            send(&mut wire, event("root","Runtime.consoleAPICalled",json!({"type":"log","args":[]}))).await;
                        }
                        send(&mut wire, reply(7, "root")).await;
                    }
                    Case::Malformed => send_raw(&mut wire, Message::Text("{private-fixture-marker".into())).await,
                    Case::Duplicate => send_raw(&mut wire, Message::Text(
                        r#"{"method":"Runtime.consoleAPICalled","method":"Runtime.consoleAPICalled","sessionId":"root","params":{"type":"error","args":[]}}"#.into()
                    )).await,
                    Case::Cancel => {
                        cancel.send(()).expect("capture waiting for cancellation");
                    }
                    _ => {}
                }
                if !matches!(case, Case::Hold | Case::Cancel) {
                    send(&mut wire, json!({"fixture_barrier":"cutoff"})).await;
                }
            }
        }
    }
    expect_command(
        &mut wire,
        json!({"id":8,"method":"Target.closeTarget","params":{"targetId":"owned-root"}}),
    )
    .await;
    let owned_remains = case == Case::ClosePresent;
    send(
        &mut wire,
        json!({"id":if case == Case::BadClose {9} else {8},"result":{"success":true}}),
    )
    .await;
    expect_command(&mut wire, json!({"id":9,"method":"Target.getTargets"})).await;
    let targets = if owned_remains {
        json!(["owned-root", "sentinel"])
    } else {
        json!(["sentinel"])
    };
    send(
        &mut wire,
        json!({"id":9,"result":{"fixture_target_ids":targets}}),
    )
    .await;
    let close = timeout(CLEANUP, wire.next())
        .await
        .expect("fixture close deadline");
    assert!(matches!(close, Some(Ok(Message::Close(_)))));
    timeout(CLEANUP, wire.flush())
        .await
        .expect("fixture flush deadline")
        .expect("fixture flush");
}

async fn response(
    wire: &mut Wire,
    expected: Value,
) -> Result<tokio_tungstenite::tungstenite::Utf8Bytes, &'static str> {
    let text = read_wire(wire).await?;
    if text.as_str() == expected.to_string() {
        Ok(text)
    } else {
        Err("CAPTURE_ACK_MISSING")
    }
}

async fn read_wire(
    wire: &mut Wire,
) -> Result<tokio_tungstenite::tungstenite::Utf8Bytes, &'static str> {
    use tokio_tungstenite::tungstenite::Error;
    match timeout(READINESS, wire.next()).await {
        Ok(Some(Ok(Message::Text(text)))) => Ok(text),
        Ok(Some(Err(Error::Capacity(_)))) => Err("CAPTURE_OVERFLOW"),
        Ok(Some(Ok(Message::Close(_)))) | Ok(Some(Err(_))) | Ok(None) => {
            Err("CAPTURE_DISCONNECTED")
        }
        Ok(Some(Ok(_))) => Err("CAPTURE_MALFORMED"),
        Err(_) => Err("CAPTURE_DEADLINE"),
    }
}

async fn enable(
    wire: &mut Wire,
    replay: &mut reducer::contract_support::Replay,
    id: u8,
    method: &str,
    session: &str,
) -> Result<(), &'static str> {
    replay.send_control(&json!({"rpc_sent":id,"method":method,"session":session}));
    send(wire, command(id, method, session)).await;
    let text = response(wire, reply(id, session)).await?;
    replay.send(text.as_bytes());
    Ok(())
}

async fn capture(
    wire: &mut Wire,
    replay: &mut reducer::contract_support::Replay,
    cancel: oneshot::Receiver<()>,
) -> Result<(), &'static str> {
    replay.send_control(&json!({"synthetic_owned_page":true,"session":"root"}));
    enable(wire, replay, 1, "Runtime.enable", "root").await?;
    enable(wire, replay, 2, "Network.enable", "root").await?;
    let relation = read_wire(wire).await?;
    let owned_child =
        json!({"fixture_related":{"parent":"root","session":"child","target":"owned-child"}});
    if relation.as_str() == owned_child.to_string() {
        replay.send_control(&json!({"owned_descendants":[["child","owned-child"]],"required_descendant_session":"child"}));
        enable(wire, replay, 3, "Runtime.enable", "child").await?;
        enable(wire, replay, 4, "Network.enable", "child").await?;
        send(wire, command(5, "Runtime.runIfWaitingForDebugger", "child")).await;
        response(wire, reply(5, "child")).await?;
    } else if relation.as_str() != r#"{"fixture_related":null}"# {
        return Err("CAPTURE_SCOPE_UNVERIFIED");
    }
    replay.send_control(&json!({"begin_window":true}));
    send(wire, command(6, "Page.navigate", "root")).await;
    response(wire, reply(6, "root")).await?;
    replay.send_control(&json!({"rpc_sent":7,"method":"Runtime.evaluate","session":"root"}));
    send(wire, command(7, "Runtime.evaluate", "root")).await;
    let cancel = async {
        if cancel.await.is_err() {
            std::future::pending::<()>().await;
        }
    };
    tokio::pin!(cancel);
    loop {
        let frame = tokio::select! {
            _ = &mut cancel => return Err("CAPTURE_CANCELLED_INT"),
            frame = read_wire(wire) => frame?,
        };
        if frame.as_str() == r#"{"fixture_barrier":"cutoff"}"# {
            break;
        }
        replay.send(frame.as_bytes());
    }
    replay.send_control(&json!({"close_window":true}));
    Ok(())
}

async fn verify_close(wire: &mut Wire) -> Result<(), &'static str> {
    send(
        wire,
        json!({"id":8,"method":"Target.closeTarget","params":{"targetId":"owned-root"}}),
    )
    .await;
    let acknowledged = response(wire, json!({"id":8,"result":{"success":true}})).await;
    send(wire, json!({"id":9,"method":"Target.getTargets"})).await;
    let absent = response(
        wire,
        json!({"id":9,"result":{"fixture_target_ids":["sentinel"]}}),
    )
    .await;
    if acknowledged.is_err() || absent.is_err() {
        return Err("CAPTURE_SCOPE_UNVERIFIED");
    }
    Ok(())
}

async fn observe(address: std::net::SocketAddr, cancel: oneshot::Receiver<()>) -> Value {
    let mut wire = client_wire(address).await;
    let mut replay = reducer::contract_support::Replay::new();
    match capture(&mut wire, &mut replay, cancel).await {
        Err(code @ ("CAPTURE_OVERFLOW" | "CAPTURE_DISCONNECTED")) => {
            // In this fixture the peer owns the synthetic targets. A terminal
            // transport fault cannot produce a verified target-close receipt.
            replay.send_control(&json!({"fault":code}));
        }
        result => {
            if let Err(code) = result {
                replay.send_control(&json!({"fault":code}));
            }
            let closed = timeout(CLEANUP, verify_close(&mut wire)).await;
            if !matches!(closed, Ok(Ok(()))) {
                replay.send_control(&json!({"fault":"CAPTURE_SCOPE_UNVERIFIED"}));
            }
            timeout(CLEANUP, wire.close(None))
                .await
                .expect("client close deadline")
                .expect("client close");
        }
    }
    serde_json::to_value(replay.finish()).expect("safe receipt")
}

fn run(case: Case) -> Value {
    runtime().block_on(async {
        timeout(FIXTURE, async {
            let listener = fixture_listener().await;
            let address = listener.local_addr().unwrap();
            let (sender, receiver) = oneshot::channel();
            let (receipt, ()) =
                tokio::join!(observe(address, receiver), peer(listener, case, sender));
            assert_eq!(receipt["preparation_only"], true);
            assert!(!receipt.to_string().contains("private-fixture-marker"));
            receipt
        })
        .await
        .expect("owned fixture deadline")
    })
}

#[test]
fn l01_empty_window() {
    assert_eq!(run(Case::Empty)["decision"], "clean");
}

#[test]
fn l02_exact_seeded_errors() {
    let receipt = run(Case::Errors);
    assert_eq!(receipt["decision"], "errors");
    assert_eq!(
        receipt["counts"],
        json!({"console_error":1,"runtime_exception":1,"http_error":2,"transport_error":0})
    );
}

#[test]
fn l03_continuous_traffic_cutoff() {
    let receipt = run(Case::Ongoing);
    assert_eq!(receipt["decision"], "clean");
    assert_eq!(receipt["pending_at_cutoff"], 2);
    let receipt = run(Case::OngoingError);
    assert_eq!(receipt["decision"], "errors");
    assert_eq!(receipt["pending_at_cutoff"], 2);
    assert_eq!(receipt["counts"]["console_error"], 1);
}

#[test]
fn l04_readiness_refuses_unsafe_navigation() {
    for (case, code) in [
        (Case::AckError, "CAPTURE_ACK_MISSING"),
        (Case::AckLate, "CAPTURE_DEADLINE"),
        (Case::AckWrong, "CAPTURE_ACK_MISSING"),
        (Case::Disconnect, "CAPTURE_DISCONNECTED"),
    ] {
        assert_eq!(run(case)["diagnostics"], json!([code]));
    }
}

#[test]
fn l05_wire_and_ledger_caps() {
    for case in [
        Case::FrameOverflow,
        Case::FragmentOverflow,
        Case::EventOverflow,
    ] {
        assert_eq!(
            run(case)["diagnostics"],
            json!(["CAPTURE_OVERFLOW"]),
            "{case:?}"
        );
    }
}

#[test]
fn l06_foreign_or_unproved_scope() {
    assert_eq!(
        run(Case::Foreign)["diagnostics"],
        json!(["CAPTURE_SCOPE_UNVERIFIED"])
    );
}

#[test]
fn l07_invalid_event_and_privacy() {
    for case in [Case::Malformed, Case::Duplicate] {
        assert_eq!(run(case)["diagnostics"], json!(["CAPTURE_MALFORMED"]));
    }
    assert_eq!(run(Case::OngoingError)["counts"]["console_error"], 1);
}

#[test]
fn l08_cancellation_and_mismatched_close() {
    assert_eq!(run(Case::Cancel)["exit"], 130);
    assert_eq!(run(Case::Hold)["diagnostics"], json!(["CAPTURE_DEADLINE"]));
    assert_eq!(
        run(Case::BadClose)["diagnostics"],
        json!(["CAPTURE_SCOPE_UNVERIFIED"])
    );
}

#[test]
fn l09_acknowledged_but_present() {
    assert_eq!(
        run(Case::ClosePresent)["diagnostics"],
        json!(["CAPTURE_SCOPE_UNVERIFIED"])
    );
    assert_eq!(run(Case::Empty)["exit"], 0);
}
