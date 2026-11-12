use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[path = "support/cleanup_observation.rs"]
mod cleanup_observation;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Terminal {
    Success,
    Failure,
    Unknown,
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Reservation {
    Held,
    NotHeld,
    Unknown,
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Ownership {
    Owned,
    NotOwned,
    Unknown,
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Identity {
    Matches,
    Mismatch,
    Unknown,
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Term {
    Sent,
    PermissionDenied,
    OtherError,
    Unknown,
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Cleanup {
    Success,
    Failure,
    Unknown,
}

#[derive(Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct Receipt {
    terminal: Terminal,
    reservation: Reservation,
    target: Ownership,
    group: Ownership,
    identity: Identity,
    term: Term,
    cleanup: Cleanup,
}

#[derive(Debug, PartialEq)]
enum Qualification {
    Complete,
    Unqualified,
}

fn validate(value: Value) -> Result<(String, Qualification), &'static str> {
    let receipt: Receipt = serde_json::from_value(value).map_err(|_| "invalid receipt")?;
    let complete = receipt.terminal != Terminal::Unknown
        && receipt.reservation == Reservation::Held
        && receipt.target == Ownership::Owned
        && receipt.group == Ownership::Owned
        && receipt.identity == Identity::Matches
        && receipt.term != Term::Unknown
        && receipt.cleanup != Cleanup::Unknown
        && !(matches!(receipt.term, Term::PermissionDenied | Term::OtherError)
            && receipt.cleanup == Cleanup::Success);
    let encoded = serde_json::to_string(&receipt).map_err(|_| "invalid receipt")?;
    Ok((
        encoded,
        if complete {
            Qualification::Complete
        } else {
            Qualification::Unqualified
        },
    ))
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum Requested {
    Yes,
    No,
    Unknown,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum ObservationTerm {
    Sent,
    PermissionDenied,
    NotFound,
    OtherError,
    Unknown,
}

#[derive(Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct Observation {
    terminal: Terminal,
    reservation: Reservation,
    handle: Identity,
    group_requested: Requested,
    group_match: Identity,
    owner_match: Identity,
    term: ObservationTerm,
    cleanup: Cleanup,
}

fn validate_observation(value: Value) -> Result<(String, cleanup_observation::State), &'static str> {
    use cleanup_observation::{Evidence, Fact, State};
    let observation: Observation = serde_json::from_value(value).map_err(|_| "invalid receipt")?;
    let identity = |value| match value {
        Identity::Matches => Fact::Yes,
        Identity::Mismatch => Fact::No,
        Identity::Unknown => Fact::Unknown,
    };
    let evidence = Evidence {
        terminal: match observation.terminal {
            Terminal::Success => cleanup_observation::Terminal::Success,
            Terminal::Failure => cleanup_observation::Terminal::Failure,
            Terminal::Unknown => cleanup_observation::Terminal::Unknown,
        },
        reserved: match observation.reservation {
            Reservation::Held => Fact::Yes,
            Reservation::NotHeld => Fact::No,
            Reservation::Unknown => Fact::Unknown,
        },
        handle: identity(observation.handle),
        fresh_group_requested: match observation.group_requested {
            Requested::Yes => Fact::Yes,
            Requested::No => Fact::No,
            Requested::Unknown => Fact::Unknown,
        },
        group_match: identity(observation.group_match),
        owner_match: identity(observation.owner_match),
    };
    let state = cleanup_observation::classify(evidence);
    let state = if state == State::Contradictory ||
        (matches!(observation.term, ObservationTerm::PermissionDenied | ObservationTerm::OtherError)
            && observation.cleanup == Cleanup::Success) {
        State::Contradictory
    } else if state == State::Incomplete || observation.term == ObservationTerm::Unknown ||
        observation.cleanup == Cleanup::Unknown {
        State::Incomplete
    } else {
        State::Consistent
    };
    let encoded = serde_json::to_string(&observation).map_err(|_| "invalid receipt")?;
    Ok((encoded, state))
}

fn valid() -> Value {
    json!({"terminal":"success", "reservation":"held", "target":"owned", "group":"owned", "identity":"matches", "term":"sent", "cleanup":"success"})
}

fn observed() -> Value {
    json!({"terminal":"success", "reservation":"held", "handle":"matches",
        "group_requested":"yes", "group_match":"matches", "owner_match":"matches",
        "term":"permission_denied", "cleanup":"failure"})
}

#[test]
fn complete_record_accepted() {
    let (encoded, qualification) = validate(valid()).expect("complete record");
    assert_eq!(qualification, Qualification::Complete);
    assert_eq!(serde_json::from_str::<Value>(&encoded).unwrap(), valid());
    let (encoded, state) = validate_observation(observed()).expect("bounded observation");
    assert_eq!(state, cleanup_observation::State::Consistent);
    assert_eq!(serde_json::from_str::<Value>(&encoded).unwrap(), observed());
}

#[test]
fn missing_field_refused() {
    for field in [
        "terminal",
        "reservation",
        "target",
        "group",
        "identity",
        "term",
        "cleanup",
    ] {
        let mut value = valid();
        value.as_object_mut().unwrap().remove(field);
        assert_eq!(validate(value).unwrap_err(), "invalid receipt");
    }
}

#[test]
fn unknown_terminal_unqualified() {
    let mut value = valid();
    value["terminal"] = json!("unknown");
    assert_eq!(validate(value).unwrap().1, Qualification::Unqualified);
    let mut observation = observed();
    observation["terminal"] = json!("unknown");
    assert_eq!(validate_observation(observation).unwrap().1, cleanup_observation::State::Incomplete);
}

#[test]
fn unknown_reservation_unqualified() {
    let mut value = valid();
    value["reservation"] = json!("unknown");
    assert_eq!(validate(value).unwrap().1, Qualification::Unqualified);
    let mut observation = observed();
    observation["reservation"] = json!("unknown");
    assert_eq!(validate_observation(observation).unwrap().1, cleanup_observation::State::Incomplete);
}

#[test]
fn unknown_ownership_unqualified() {
    for field in ["target", "group", "identity"] {
        let mut value = valid();
        value[field] = json!("unknown");
        assert_eq!(validate(value).unwrap().1, Qualification::Unqualified);
    }
    for field in ["handle", "group_requested", "group_match", "owner_match"] {
        let mut value = observed();
        value[field] = json!("unknown");
        assert_eq!(validate_observation(value).unwrap().1, cleanup_observation::State::Incomplete);
    }
    for (field, mismatch) in [("handle", "mismatch"), ("group_requested", "no"),
                              ("group_match", "mismatch"), ("owner_match", "mismatch")] {
        let mut value = observed();
        value[field] = json!(mismatch);
        value["terminal"] = json!("unknown");
        assert_eq!(validate_observation(value).unwrap().1, cleanup_observation::State::Contradictory);
    }
}

#[test]
fn invalid_enum_refused() {
    for field in [
        "terminal",
        "reservation",
        "target",
        "group",
        "identity",
        "term",
        "cleanup",
    ] {
        let mut value = valid();
        value[field] = json!("invalid");
        assert_eq!(validate(value).unwrap_err(), "invalid receipt");
    }
}

#[test]
fn private_fields_refused() {
    for field in ["pid", "command", "environment", "payload"] {
        let marker = format!("private-{field}-marker");
        let mut value = valid();
        value[field] = json!(marker);
        let error = validate(value).unwrap_err();
        assert_eq!(error, "invalid receipt");
        assert!(!error.contains(&marker));
        let mut observation = observed();
        observation[field] = json!(marker);
        assert_eq!(validate_observation(observation).unwrap_err(), "invalid receipt");
    }
}

#[test]
fn cleanup_outcome_unchanged() {
    for (term, cleanup, expected) in [
        ("sent", "success", Qualification::Complete),
        ("permission_denied", "failure", Qualification::Complete),
        ("unknown", "failure", Qualification::Unqualified),
        ("sent", "unknown", Qualification::Unqualified),
    ] {
        let mut value = valid();
        value["term"] = json!(term);
        value["cleanup"] = json!(cleanup);
        let (encoded, qualification) = validate(value).expect("closed values");
        let actual: Value = serde_json::from_str(&encoded).unwrap();
        assert_eq!(actual["term"], term);
        assert_eq!(actual["cleanup"], cleanup);
        assert_eq!(qualification, expected);
    }
    for term in ["sent", "permission_denied", "not_found", "other_error", "unknown"] {
        let mut value = observed();
        value["term"] = json!(term);
        let (encoded, _) = validate_observation(value).expect("closed observation");
        let actual: Value = serde_json::from_str(&encoded).unwrap();
        assert_eq!(actual["term"], term);
        assert_eq!(actual["cleanup"], "failure");
    }
    for field in ["term", "cleanup"] {
        let mut value = observed();
        value[field] = json!("unknown");
        assert_eq!(validate_observation(value).unwrap().1, cleanup_observation::State::Incomplete);
    }
    let mut already_absent = observed();
    already_absent["term"] = json!("not_found");
    already_absent["cleanup"] = json!("success");
    assert_eq!(validate_observation(already_absent).unwrap().1, cleanup_observation::State::Consistent);
}

#[test]
fn eperm_success_conflict_unqualified() {
    for term in ["permission_denied", "other_error"] {
        let mut value = valid();
        value["term"] = json!(term);
        value["cleanup"] = json!("success");
        let (encoded, qualification) = validate(value).expect("closed values");
        let actual: Value = serde_json::from_str(&encoded).unwrap();
        assert_eq!(actual["cleanup"], "success");
        assert_eq!(
            qualification,
            Qualification::Unqualified,
            "conflicting EPERM marked complete"
        );
    }
    for term in ["permission_denied", "other_error"] {
        let mut value = observed();
        value["term"] = json!(term);
        value["cleanup"] = json!("success");
        assert_eq!(validate_observation(value).unwrap().1, cleanup_observation::State::Contradictory);
    }
}
