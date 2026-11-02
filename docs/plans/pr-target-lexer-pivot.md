# PR target parsing: lexical boundary

The first uncommitted parser candidate passed its 18 fixtures but failed
three independent review probes: an embedded hash character, an attached
shell operator, and a later quoted executable. Its patch digest was
38139b810979438ba5e4f0982e78154e872d0f164fd288c90ce4467b379193da.
Do not deliver that candidate.

Hypothesis: replacing split-only parsing and raw-text candidate discovery
with the standard shell lexer improves those three decisions from zero
correct to three correct. Shell operators and unsupported syntax produce
no query. An embedded hash stays literal; a quoted executable selects the
latest PR rather than retaining an earlier target.

Measurement: `bash hooks/checks/a-pr-is-not-ready.test.sh`.
Success: all three review controls and the existing 18 controls pass, with
zero wrong repository queries. Pivot: any wrong query abandons attribution
for that unsupported form; do not expand guessed parsing to pass a case.
Anchor: Basili, Caldiera, Rombach (1994), Goal Question Metric; Python
standard-library shlex lexer and Bash command boundaries.

This record precedes the replacement implementation. The three failed
review observations are known baseline evidence, not unseen results.
