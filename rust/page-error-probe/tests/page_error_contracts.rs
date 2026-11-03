#![forbid(unsafe_code)]
#[path = "../src/page_errors.rs"]
mod subject;
use serde_json::Value;
const REGISTRY: &str = include_str!("../fixtures/page-errors/manifest.json");
fn run(case_id: &str, variant: &str) {
    let registry: Value = serde_json::from_str(REGISTRY).expect("sealed synthetic registry");
    let case = registry["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["case_id"] == case_id && c["variant"] == variant)
        .expect("registered case");
    let mut replay = subject::contract_support::Replay::new();
    for step in case["steps"].as_array().unwrap() {
        match step["op"].as_str().unwrap() {
            "frame" => replay.send(step["text"].as_str().unwrap().as_bytes()),
            "repeat" => {
                for _ in 0..step["count"].as_u64().unwrap() {
                    replay.send(step["frame"].as_str().unwrap().as_bytes());
                }
            }
            "oversize" => {
                let data = vec![b'x'; step["bytes"].as_u64().unwrap() as usize];
                if step["fragmented"] == true {
                    replay.fragment(&data[..32768], false);
                    replay.fragment(&data[32768..], true);
                } else {
                    replay.send(&data);
                }
            }
            "control" => replay.send_control(&step["control"]),
            _ => panic!("unregistered fixture operation"),
        }
    }
    let actual = serde_json::to_value(replay.finish()).unwrap();
    let rendered = actual.to_string();
    assert!(
        !rendered.contains("FIXTURE_PRIVATE_SENTINEL_563"),
        "private fixture marker escaped"
    );
    for (key, expected) in case["expected"].as_object().unwrap() {
        assert_eq!(
            &actual[key], expected,
            "semantic contract mismatch for {case_id}/{variant}: {key}"
        );
    }
}
#[test]
fn p01_default() {
    run("P01", "default");
}
#[test]
fn p02_default() {
    run("P02", "default");
}
#[test]
fn p03_default() {
    run("P03", "default");
}
#[test]
fn p04_default() {
    run("P04", "default");
}
#[test]
fn p05_default() {
    run("P05", "default");
}
#[test]
fn p06_default() {
    run("P06", "default");
}
#[test]
fn p07_default() {
    run("P07", "default");
}
#[test]
fn p08_default() {
    run("P08", "default");
}
#[test]
fn p09_default() {
    run("P09", "default");
}
#[test]
fn p10_default() {
    run("P10", "default");
}
#[test]
fn p11_default() {
    run("P11", "default");
}
#[test]
fn p12_default() {
    run("P12", "default");
}
#[test]
fn p13_default() {
    run("P13", "default");
}
#[test]
fn p14_default() {
    run("P14", "default");
}
#[test]
fn p15_disconnect() {
    run("P15", "disconnect");
}
#[test]
fn p15_deadline() {
    run("P15", "deadline");
}
#[test]
fn p15_stream_cap() {
    run("P15", "stream-cap");
}
#[test]
fn p16_default() {
    run("P16", "default");
}
#[test]
fn p17_default() {
    run("P17", "default");
}
#[test]
fn p18_default() {
    run("P18", "default");
}
#[test]
fn p19_default() {
    run("P19", "default");
}
#[test]
fn p20_console_marker() {
    run("P20", "console-marker");
}
#[test]
fn p20_url_marker() {
    run("P20", "url-marker");
}
#[test]
fn p20_malformed_marker() {
    run("P20", "malformed-marker");
}
#[test]
fn p21_timeout() {
    run("P21", "timeout");
}
#[test]
fn p21_int() {
    run("P21", "int");
}
#[test]
fn p21_term() {
    run("P21", "term");
}
#[test]
fn p22_missing_executable() {
    run("P22", "missing-executable");
}
#[test]
fn p22_missing_response_capability() {
    run("P22", "missing-response-capability");
}
#[test]
fn p22_missing_readiness() {
    run("P22", "missing-readiness");
}
#[test]
fn p22_invalid_origin() {
    run("P22", "invalid-origin");
}
#[test]
fn p23_default() {
    run("P23", "default");
}
#[test]
fn p24_claude() {
    run("P24", "claude");
}
#[test]
fn p24_codex() {
    run("P24", "codex");
}
#[test]
fn t01_default() {
    run("T01", "default");
}
#[test]
fn t02_default() {
    run("T02", "default");
}
#[test]
fn t03_default() {
    run("T03", "default");
}
#[test]
fn t04_default() {
    run("T04", "default");
}
#[test]
fn t05_single_frame() {
    run("T05", "single-frame");
}
#[test]
fn t05_fragmented_message() {
    run("T05", "fragmented-message");
}
#[test]
fn t06_runtime_delayed() {
    run("T06", "runtime-delayed");
}
#[test]
fn t06_runtime_failed() {
    run("T06", "runtime-failed");
}
#[test]
fn t06_network_delayed() {
    run("T06", "network-delayed");
}
#[test]
fn t06_network_failed() {
    run("T06", "network-failed");
}
#[test]
fn t06_descendants_delayed() {
    run("T06", "descendants-delayed");
}
#[test]
fn t06_descendants_failed() {
    run("T06", "descendants-failed");
}
#[test]
fn t07_default() {
    run("T07", "default");
}
#[test]
fn t08_malformed_json() {
    run("T08", "malformed-json");
}
#[test]
fn t08_duplicate_id() {
    run("T08", "duplicate-id");
}
#[test]
fn t08_duplicate_method() {
    run("T08", "duplicate-method");
}
#[test]
fn t08_duplicate_session() {
    run("T08", "duplicate-session");
}
#[test]
fn t08_duplicate_status() {
    run("T08", "duplicate-status");
}
#[test]
fn t09_header() {
    run("T09", "header");
}
#[test]
fn t09_post_data() {
    run("T09", "post-data");
}
#[test]
fn t09_url_message() {
    run("T09", "url-message");
}
#[test]
fn t10_continuous_poll() {
    run("T10", "continuous-poll");
}
#[test]
fn t10_sse() {
    run("T10", "sse");
}
#[test]
fn t10_error_before_close() {
    run("T10", "error-before-close");
}
#[test]
fn production_unqualified_decoder_never_accepts_forged_scope() {
    let mut decoder = migration_check::page_errors::Decoder::unqualified();
    let _ = decoder.receive(br#"{"owned":true,"complete":true,"exit":0}"#);
    let result = serde_json::to_value(decoder.close()).unwrap();
    assert_eq!(result["exit"], 2);
    assert_eq!(result["coverage"], "incomplete");
    assert_eq!(result["preparation_only"], true);
}
