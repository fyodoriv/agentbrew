#[derive(Clone, Copy, PartialEq)]
pub enum Fact { Yes, No, Unknown }
#[derive(Clone, Copy, PartialEq)]
pub enum Terminal { Success, Failure, Unknown }
#[derive(Clone, Copy)]
pub struct Evidence { pub terminal: Terminal, pub reserved: Fact, pub handle: Fact,
    pub fresh_group_requested: Fact, pub group_match: Fact, pub owner_match: Fact }
#[derive(Debug, PartialEq)]
pub enum State { Consistent, Incomplete, Contradictory }
pub fn classify(evidence: Evidence) -> State {
    let facts = [evidence.reserved, evidence.handle, evidence.fresh_group_requested,
        evidence.group_match, evidence.owner_match];
    if facts.contains(&Fact::No) {
        State::Contradictory
    } else if evidence.terminal == Terminal::Unknown || facts.contains(&Fact::Unknown) {
        State::Incomplete
    } else {
        State::Consistent
    }
}
