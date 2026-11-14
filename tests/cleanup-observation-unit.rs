#[path = "../rust/tests/support/cleanup_observation.rs"]
mod observation;
use observation::{classify, Evidence, Fact, State, Terminal};

fn complete() -> Evidence {
    Evidence { terminal: Terminal::Success, reserved: Fact::Yes, handle: Fact::Yes,
        fresh_group_requested: Fact::Yes, group_match: Fact::Yes, owner_match: Fact::Yes }
}

#[test]
fn consistent_facts_are_not_an_ownership_verdict() {
    assert_eq!(classify(complete()), State::Consistent);
    assert_eq!(classify(Evidence { terminal: Terminal::Failure, ..complete() }), State::Consistent);
}

#[test]
fn unknowns_never_become_consistent() {
    let e = complete();
    for sample in [Evidence { terminal: Terminal::Unknown, ..e }, Evidence { reserved: Fact::Unknown, ..e },
        Evidence { handle: Fact::Unknown, ..e }, Evidence { fresh_group_requested: Fact::Unknown, ..e },
        Evidence { group_match: Fact::Unknown, ..e }, Evidence { owner_match: Fact::Unknown, ..e }] {
        assert_eq!(classify(sample), State::Incomplete);
    }
}

#[test]
fn mismatches_take_precedence_over_unknowns() {
    let e = complete();
    for sample in [Evidence { reserved: Fact::No, ..e }, Evidence { handle: Fact::No, ..e },
        Evidence { fresh_group_requested: Fact::No, ..e }, Evidence { group_match: Fact::No, ..e },
        Evidence { owner_match: Fact::No, terminal: Terminal::Unknown, ..e }] {
        assert_eq!(classify(sample), State::Contradictory);
    }
}
