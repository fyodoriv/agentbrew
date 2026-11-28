def blocks: .message.content? | arrays | .[] | objects;
def starts_turn:
  .type == "user" and (.isMeta // false | not) and
  ((.message.content | type) == "string" or
    (([blocks | select(.type == "text")] | length) > 0 and
     ([blocks | select(.type == "tool_result")] | length) == 0));

def edits_code:
  .type == "tool_use" and (.name == "Write" or .name == "Edit") and
  (.input.file_path | strings | test("\\.(ts|tsx|js|jsx|py|sh|go|rs|java|rb|cpp|c|h)$"));

def local_gate:
  test("^(?:" +
    "(?:npm|yarn|pnpm)\\s+(?:test|run\\s+(?:test|verify|build|check|lint|typecheck))|" +
    "npx\\s+(?:vitest|jest|tsc|biome)|tsc\\s+--noEmit|pytest|shellcheck|bats|" +
    "go\\s+test|cargo\\s+(?:test|check)|make\\s+check|(?:bash\\s+)?(?:\\./)?scripts/check\\.sh" +
    ")\\b");

def gate:
  if type != "string" or test("[;&|\\n\\r]|\\s(?:--help|-h|--version|--dry-run|--list|--list-tests)(?:\\s|$)") then null
  else
    sub("^\\s*(?:[A-Za-z_][A-Za-z0-9_]*=\\S+\\s+)*"; "") |
    sub("^(?:timeout\\s+\\S+\\s+|heavy-run\\s+(?:--exclusive\\s+)?)+";
      "") |
    if test("^gh\\s+run\\s+watch\\s+[0-9]+(?:\\s|$)") and
       test("\\s--exit-status(?:=true)?(?:\\s|$)") and
       (test("\\s--exit-status=(?!true(?:\\s|$))") | not) then
      {run: capture("^gh\\s+run\\s+watch\\s+(?<id>[0-9]+)").id}
    elif test("^(?:bash\\s+)?\\S*ci-watch-fail-fast\\.sh\\s") and test("\\s[0-9]{6,}(?:\\s|$)") then
      {run: capture("\\s(?<id>[0-9]{6,})(?:\\s|$)").id}
    elif local_gate then
      {}
    else null end
  end;

def result_text:
  if type == "string" then .
  elif type == "array" then map(.text? // "" | strings) | join("\n")
  else "" end;

def passed($gate):
  (.content | result_text) as $text |
  .is_error != true and
  ($text | test("^\\s*(?:PreToolUse hook (?:refused|denied)|Tool use was rejected|Command running in background|Command timed out|Exit code [1-9][0-9]*)\\b"; "i") | not) and
  ($gate.run == null or
    ($text | test("(?m)^Run [^\\r\\n]* \\(" + $gate.run + "\\) (?:has already )?completed with \\x27success\\x27\\s*$")));

reduce inputs as $row
  ({edits: 0, checks: {}};
    if $row | starts_turn then {edits: 0, checks: {}}
    else reduce ($row | blocks) as $entry (.;
      if any($entry | edits_code; .) then .edits += 1
      elif $entry.type == "tool_use" and $entry.name == "Bash" and
           ($entry.id | type) == "string" and $entry.id != "" then
        if .checks[$entry.id] != null then .checks[$entry.id] = {duplicate: true}
        else
          .checks[$entry.id] = {
            gate: (if $entry.input.run_in_background == true then null else $entry.input.command | gate end),
            after_edit: .edits
          }
        end
      elif $entry.type == "tool_result" and ($entry.tool_use_id | type) == "string" and
           .checks[$entry.tool_use_id] != null then
        .checks[$entry.tool_use_id] |= (
          if .has_result then {duplicate: true}
          else . as $attempt |
            .has_result = true |
            .passed = ($attempt.gate != null and ($entry | passed($attempt.gate)))
          end)
      else . end)
    end)
| .edits as $edits
| [$edits, ([.checks[] | select(.passed and .after_edit == $edits)] | length)]
| @tsv
