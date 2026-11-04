//! Capture-run reduction only. Native transport ownership and closure stay unqualified.

use serde::de::{DeserializeSeed, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde::Serialize;
use serde_json::{Map, Number, Value};
use std::cell::Cell;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::rc::Rc;

const WIRE_BYTES: usize = 65_536;
const CASE_BYTES: usize = 1_048_576;
const EVENT_CAP: usize = 1024;
const SESSION_CAP: usize = 32;
const RPC_CAP: usize = 8;
const REQUEST_CAP: usize = 512;
const MALFORMED: &str = "CAPTURE_MALFORMED";
const OVERFLOW: &str = "CAPTURE_OVERFLOW";
const ACK: &str = "CAPTURE_ACK_MISSING";
const MISSING: &str = "CAPTURE_MISSING_CAPABILITY";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Diagnostic {
    code: &'static str,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Counts {
    console_error: u32,
    runtime_exception: u32,
    http_error: u32,
    transport_error: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Receipt {
    schema_version: u8,
    preparation_only: bool,
    coverage: &'static str,
    decision: &'static str,
    exit: u8,
    counts: Counts,
    introduced: Option<u32>,
    resolved: Option<u32>,
    inherited: Option<u32>,
    pending_at_cutoff: u32,
    diagnostics: Vec<&'static str>,
}

// The visitor rejects duplicates before a Value map can collapse them. Sensitive
// passive fields are skipped without building their value trees.
#[derive(Clone)]
struct Seed {
    remaining: Rc<Cell<usize>>,
}
impl Seed {
    fn charge<E: serde::de::Error>(&self, bytes: usize) -> Result<(), E> {
        let left = self.remaining.get();
        if bytes > left {
            return Err(E::custom("capture-overflow"));
        }
        self.remaining.set(left - bytes);
        Ok(())
    }
}
impl<'de> DeserializeSeed<'de> for Seed {
    type Value = Value;
    fn deserialize<D: serde::Deserializer<'de>>(self, d: D) -> Result<Value, D::Error> {
        self.charge::<D::Error>(128)?;
        d.deserialize_any(self)
    }
}
impl<'de> Visitor<'de> for Seed {
    type Value = Value;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("bounded JSON")
    }
    fn visit_bool<E: serde::de::Error>(self, v: bool) -> Result<Value, E> {
        Ok(Value::Bool(v))
    }
    fn visit_unit<E: serde::de::Error>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }
    fn visit_i64<E: serde::de::Error>(self, v: i64) -> Result<Value, E> {
        Ok(Value::Number(v.into()))
    }
    fn visit_u64<E: serde::de::Error>(self, v: u64) -> Result<Value, E> {
        Ok(Value::Number(v.into()))
    }
    fn visit_f64<E: serde::de::Error>(self, v: f64) -> Result<Value, E> {
        Number::from_f64(v)
            .map(Value::Number)
            .ok_or_else(|| E::custom("capture-malformed"))
    }
    fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Value, E> {
        self.charge::<E>(v.len())?;
        Ok(Value::String(v.to_owned()))
    }
    fn visit_string<E: serde::de::Error>(self, v: String) -> Result<Value, E> {
        self.charge::<E>(v.len())?;
        Ok(Value::String(v))
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut a: A) -> Result<Value, A::Error> {
        let mut out = Vec::new();
        while let Some(v) = a.next_element_seed(self.clone())? {
            out.push(v);
        }
        Ok(Value::Array(out))
    }
    fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<Value, A::Error> {
        let mut keys = BTreeSet::new();
        let mut out = Map::new();
        while let Some(key) = a.next_key::<String>()? {
            self.charge::<A::Error>(key.len().saturating_mul(2).saturating_add(256))?;
            if !keys.insert(key.clone()) {
                return Err(serde::de::Error::custom("capture-malformed"));
            }
            if matches!(
                key.as_str(),
                "headers" | "postData" | "responseHeaders" | "cookies"
            ) {
                let _ = a.next_value::<IgnoredAny>()?;
            } else {
                out.insert(key, a.next_value_seed(self.clone())?);
            }
        }
        Ok(Value::Object(out))
    }
}

#[derive(Clone)]
struct Request {
    status: Option<u16>,
}

/// One capture-run. No production constructor can qualify scope or closure.
pub struct Decoder {
    qualified: bool,
    owned: BTreeSet<String>,
    required_children: BTreeSet<String>,
    rpcs: BTreeMap<u8, (String, String)>,
    runtime_ack: bool,
    network_ack: bool,
    begun: bool,
    cutoff: Option<u32>,
    fault: Option<&'static str>,
    events: usize,
    counts: Counts,
    groups: BTreeSet<(u8, String)>,
    before: Option<BTreeSet<String>>,
    requests: BTreeMap<(String, String), Request>,
    fragments: Vec<u8>,
    signin: Option<String>,
}
impl Decoder {
    pub fn unqualified() -> Self {
        Self {
            qualified: false,
            owned: BTreeSet::new(),
            required_children: BTreeSet::new(),
            rpcs: BTreeMap::new(),
            runtime_ack: false,
            network_ack: false,
            begun: false,
            cutoff: None,
            fault: None,
            events: 0,
            counts: Counts::default(),
            groups: BTreeSet::new(),
            before: None,
            requests: BTreeMap::new(),
            fragments: Vec::new(),
            signin: None,
        }
    }
    fn fail(&mut self, code: &'static str) -> Diagnostic {
        if self.fault.is_none() {
            self.fault = Some(code);
        }
        Diagnostic { code }
    }
    fn retained(&self) -> usize {
        self.fragments.len()
            + self.owned.iter().map(|s| s.len() + 128).sum::<usize>()
            + self
                .required_children
                .iter()
                .map(|s| s.len() + 128)
                .sum::<usize>()
            + self
                .rpcs
                .values()
                .map(|(a, b)| a.len() + b.len() + 128)
                .sum::<usize>()
            + self
                .groups
                .iter()
                .map(|(_, s)| s.len() + 128)
                .sum::<usize>()
            + self
                .before
                .as_ref()
                .map_or(0, |v| v.iter().map(|s| s.len() + 128).sum())
            + self
                .requests
                .keys()
                .map(|(a, b)| a.len() + b.len() + 256)
                .sum::<usize>()
            + self.signin.as_ref().map_or(0, |s| s.len())
    }
    pub fn receive(&mut self, frame: &[u8]) -> Result<(), Diagnostic> {
        if frame.len() > WIRE_BYTES {
            return Err(self.fail(OVERFLOW));
        }
        if let Some(code) = self.fault {
            return Err(Diagnostic { code });
        }
        if self.cutoff.is_some() {
            return Ok(());
        }
        let budget = CASE_BYTES.saturating_sub(
            self.retained()
                .saturating_add(frame.len().saturating_mul(2)),
        );
        let mut d = serde_json::Deserializer::from_slice(frame);
        let seed = Seed {
            remaining: Rc::new(Cell::new(budget)),
        };
        let value = match seed.deserialize(&mut d).and_then(|v| d.end().map(|_| v)) {
            Ok(v) => v,
            Err(e) => {
                let code = if e.to_string().starts_with("capture-overflow") {
                    OVERFLOW
                } else {
                    MALFORMED
                };
                return Err(self.fail(code));
            }
        };
        self.project(&value)?;
        if self.retained() > CASE_BYTES {
            return Err(self.fail(OVERFLOW));
        }
        Ok(())
    }
    pub fn receive_fragment(&mut self, part: &[u8], final_part: bool) -> Result<(), Diagnostic> {
        if part.len() > WIRE_BYTES
            || self.fragments.len().saturating_add(part.len()) > WIRE_BYTES
            || self.retained().saturating_add(part.len()) > CASE_BYTES
        {
            return Err(self.fail(OVERFLOW));
        }
        if let Some(code) = self.fault {
            return Err(Diagnostic { code });
        }
        self.fragments.extend_from_slice(part);
        if final_part {
            let frame = std::mem::take(&mut self.fragments);
            self.receive(&frame)
        } else {
            Ok(())
        }
    }
    fn project(&mut self, v: &Value) -> Result<(), Diagnostic> {
        if !v.is_object() {
            return Err(self.fail(MALFORMED));
        }
        if v.get("id").is_some() {
            return self.reply(v);
        }
        let method = v
            .get("method")
            .and_then(Value::as_str)
            .ok_or_else(|| self.fail(MALFORMED))?;
        let sid = v
            .get("sessionId")
            .and_then(Value::as_str)
            .ok_or_else(|| self.fail(MALFORMED))?;
        if !self.owned.contains(sid) {
            return Ok(());
        }
        if !self.begun {
            return Err(self.fail(ACK));
        }
        if self.events >= EVENT_CAP {
            return Err(self.fail(OVERFLOW));
        }
        self.events += 1;
        let p = v
            .get("params")
            .filter(|p| p.is_object())
            .ok_or_else(|| self.fail(MALFORMED))?;
        match method {
            "Runtime.consoleAPICalled" => {
                let level = p
                    .get("type")
                    .and_then(Value::as_str)
                    .ok_or_else(|| self.fail(MALFORMED))?;
                let args = p
                    .get("args")
                    .and_then(Value::as_array)
                    .ok_or_else(|| self.fail(MALFORMED))?;
                if level == "error" {
                    self.counts.console_error += 1;
                    let text = args
                        .iter()
                        .filter_map(|a| a.get("value").and_then(Value::as_str))
                        .collect::<Vec<_>>()
                        .join(" ");
                    self.groups.insert((0, text));
                }
            }
            "Runtime.exceptionThrown" => {
                let detail = p
                    .get("exceptionDetails")
                    .filter(|x| x.is_object())
                    .ok_or_else(|| self.fail(MALFORMED))?;
                let text = detail
                    .pointer("/exception/description")
                    .or_else(|| detail.get("text"))
                    .and_then(Value::as_str)
                    .ok_or_else(|| self.fail(MALFORMED))?;
                self.counts.runtime_exception += 1;
                self.groups.insert((1, text.to_owned()));
            }
            "Network.requestWillBeSent" => self.request(sid, p)?,
            "Network.responseReceived" => self.response(sid, p)?,
            "Network.loadingFinished" | "Network.loadingFailed" => {
                let id = p
                    .get("requestId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| self.fail(MALFORMED))?;
                if self
                    .requests
                    .remove(&(sid.to_owned(), id.to_owned()))
                    .is_none()
                {
                    return Err(self.fail(MALFORMED));
                }
                if method == "Network.loadingFailed" {
                    self.counts.transport_error += 1;
                    self.groups.insert((3, "request-failed".to_owned()));
                }
            }
            "Page.domContentEventFired" | "Runtime.bindingCalled" => {}
            _ => return Err(self.fail(MALFORMED)),
        }
        Ok(())
    }
    fn reply(&mut self, v: &Value) -> Result<(), Diagnostic> {
        let id = v
            .get("id")
            .and_then(Value::as_u64)
            .and_then(|n| u8::try_from(n).ok())
            .ok_or_else(|| self.fail(MALFORMED))?;
        let (method, session) = self.rpcs.remove(&id).ok_or_else(|| self.fail(MALFORMED))?;
        if v.get("error").is_some() || !v.get("result").is_some_and(Value::is_object) {
            return Err(self.fail(ACK));
        }
        if self.required_children.contains(&session) {
            self.required_children.remove(&session);
        } else {
            match method.as_str() {
                "Runtime.enable" => self.runtime_ack = true,
                "Network.enable" => self.network_ack = true,
                _ => {}
            }
        }
        Ok(())
    }
    fn request(&mut self, sid: &str, p: &Value) -> Result<(), Diagnostic> {
        let id = p
            .get("requestId")
            .and_then(Value::as_str)
            .ok_or_else(|| self.fail(MALFORMED))?;
        let url = p
            .pointer("/request/url")
            .and_then(Value::as_str)
            .ok_or_else(|| self.fail(MALFORMED))?;
        if self.signin.as_ref().is_some_and(|origin| {
            url == origin || url.strip_prefix(origin).is_some_and(|s| s.starts_with('/'))
        }) {
            return Err(self.fail("CAPTURE_AUTH_BLOCKED"));
        }
        if self.requests.len() >= REQUEST_CAP {
            return Err(self.fail(OVERFLOW));
        }
        if self
            .requests
            .insert((sid.to_owned(), id.to_owned()), Request { status: None })
            .is_some()
        {
            return Err(self.fail(MALFORMED));
        }
        Ok(())
    }
    fn response(&mut self, sid: &str, p: &Value) -> Result<(), Diagnostic> {
        let id = p
            .get("requestId")
            .and_then(Value::as_str)
            .ok_or_else(|| self.fail(MALFORMED))?;
        let status = p
            .pointer("/response/status")
            .and_then(Value::as_u64)
            .and_then(|s| u16::try_from(s).ok())
            .filter(|s| (100..=599).contains(s))
            .ok_or_else(|| self.fail(MALFORMED))?;
        let Some(request) = self.requests.get_mut(&(sid.to_owned(), id.to_owned())) else {
            return Err(self.fail(MALFORMED));
        };
        if request.status.is_some() {
            return Err(self.fail(MALFORMED));
        }
        request.status = Some(status);
        if status >= 400 {
            self.counts.http_error += 1;
            self.groups.insert((2, format!("http{status}")));
        }
        Ok(())
    }
    pub fn close(&self) -> Receipt {
        let fault = if !self.qualified {
            Some(MISSING)
        } else {
            self.fault.or_else(|| {
                if !self.begun
                    || self.cutoff.is_none()
                    || !self.runtime_ack
                    || !self.network_ack
                    || !self.required_children.is_empty()
                    || !self.rpcs.is_empty()
                    || !self.fragments.is_empty()
                {
                    Some(ACK)
                } else {
                    None
                }
            })
        };
        let errors = self.counts.console_error
            + self.counts.runtime_exception
            + self.counts.http_error
            + self.counts.transport_error;
        let (coverage, decision, exit) = match fault {
            Some("CAPTURE_AUTH_BLOCKED") => ("blocked", "blocked", 2),
            Some("CAPTURE_CANCELLED_INT") => ("incomplete", "incomplete", 130),
            Some("CAPTURE_CANCELLED_TERM") => ("incomplete", "incomplete", 143),
            Some(_) => ("incomplete", "incomplete", 2),
            None if errors > 0 => ("complete", "errors", 1),
            None => ("complete", "clean", 0),
        };
        let current: BTreeSet<&str> = self.groups.iter().map(|(_, text)| text.as_str()).collect();
        let (introduced, resolved, inherited) =
            self.before.as_ref().map_or((None, None, None), |before| {
                (
                    Some(current.iter().filter(|s| !before.contains(**s)).count() as u32),
                    Some(
                        before
                            .iter()
                            .filter(|s| !current.contains(s.as_str()))
                            .count() as u32,
                    ),
                    Some(current.iter().filter(|s| before.contains(**s)).count() as u32),
                )
            });
        Receipt {
            schema_version: 1,
            preparation_only: true,
            coverage,
            decision,
            exit,
            counts: self.counts.clone(),
            introduced,
            resolved,
            inherited,
            pending_at_cutoff: self.cutoff.unwrap_or(self.requests.len() as u32),
            diagnostics: fault.into_iter().collect(),
        }
    }
}

// Only the integration-test target includes this exact source with cfg(test).
// These replay controls cannot qualify a production Decoder.
#[cfg(test)]
pub(crate) mod contract_support {
    use super::*;
    pub(crate) struct Replay {
        decoder: Decoder,
    }
    impl Replay {
        pub(crate) fn new() -> Self {
            Self {
                decoder: Decoder::unqualified(),
            }
        }
        pub(crate) fn send(&mut self, bytes: &[u8]) {
            let _ = self.decoder.receive(bytes);
        }
        pub(crate) fn fragment(&mut self, bytes: &[u8], last: bool) {
            let _ = self.decoder.receive_fragment(bytes, last);
        }
        pub(crate) fn finish(&self) -> Receipt {
            self.decoder.close()
        }
        pub(crate) fn send_control(&mut self, c: &Value) {
            let d = &mut self.decoder;
            if c.get("synthetic_owned_page").is_some() {
                if let Some(s) = c.get("session").and_then(Value::as_str) {
                    d.qualified = true;
                    d.owned.insert(s.to_owned());
                }
            }
            if let Some(id) = c
                .get("rpc_sent")
                .and_then(Value::as_u64)
                .and_then(|n| u8::try_from(n).ok())
            {
                if d.rpcs.len() >= RPC_CAP {
                    d.fail(OVERFLOW);
                    return;
                }
                let method = c.get("method").and_then(Value::as_str).unwrap_or("");
                let session = c.get("session").and_then(Value::as_str).unwrap_or("");
                if !matches!(
                    method,
                    "Runtime.enable" | "Network.enable" | "Runtime.evaluate"
                ) || d
                    .rpcs
                    .insert(id, (method.to_owned(), session.to_owned()))
                    .is_some()
                {
                    d.fail(MALFORMED);
                }
            }
            if let Some(s) = c.get("required_descendant_session").and_then(Value::as_str) {
                d.required_children.insert(s.to_owned());
            }
            if c.get("begin_window") == Some(&Value::Bool(true)) {
                if !d.runtime_ack || !d.network_ack || !d.required_children.is_empty() {
                    d.fail(ACK);
                } else {
                    d.begun = true;
                }
            }
            if let Some(items) = c.get("owned_descendants").and_then(Value::as_array) {
                for item in items {
                    if d.owned.len() >= SESSION_CAP {
                        d.fail(OVERFLOW);
                        break;
                    }
                    if let Some(s) = item.get(0).and_then(Value::as_str) {
                        d.owned.insert(s.to_owned());
                    }
                }
            }
            if c.get("unknown_child").is_some() {
                d.fail("CAPTURE_SCOPE_UNVERIFIED");
            }
            if let Some(origin) = c.get("signin_origin").and_then(Value::as_str) {
                d.signin = Some(origin.to_owned());
            }
            if c.get("reset_generation") == Some(&Value::Bool(true)) {
                d.counts = Counts::default();
                d.groups.clear();
                d.requests.clear();
                d.events = 0;
            }
            if let Some(items) = c.get("before_groups").and_then(Value::as_array) {
                d.before = Some(
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect(),
                );
            }
            if c.get("workflow_preparation").is_some() {
                d.fail(MISSING);
            }
            if let Some(code) = c.get("fault").and_then(Value::as_str) {
                let fixed = match code {
                    "CAPTURE_DISCONNECTED" => "CAPTURE_DISCONNECTED",
                    "CAPTURE_DEADLINE" => "CAPTURE_DEADLINE",
                    "CAPTURE_OVERFLOW" => OVERFLOW,
                    "CAPTURE_ACK_MISSING" => ACK,
                    "CAPTURE_SCOPE_UNVERIFIED" => "CAPTURE_SCOPE_UNVERIFIED",
                    "CAPTURE_CANCELLED_INT" => "CAPTURE_CANCELLED_INT",
                    "CAPTURE_CANCELLED_TERM" => "CAPTURE_CANCELLED_TERM",
                    "CAPTURE_MISSING_CAPABILITY" => MISSING,
                    _ => MALFORMED,
                };
                d.fail(fixed);
            }
            if c.get("close_window").is_some() {
                d.cutoff = Some(d.requests.len() as u32);
            }
            if d.retained() > CASE_BYTES {
                d.fail(OVERFLOW);
            }
        }
    }
}
