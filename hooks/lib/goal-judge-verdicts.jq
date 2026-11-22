# Used by hooks/checks/goal-judges-before-stop.sh with
# `jq -R -r -n --argjson canon <{judge id: canonical prompt}>`.
# Input: a Claude Code transcript, read as raw lines (a torn last line is
# skipped, not fatal). Only rows after the last `/goal <condition>` command
# count, so an earlier goal's judges never count for this one.
# Output, tab-separated:
#   R <n>       judge launches (background) with no completion yet
#   P <tool_use_id> <judge> <rubric sha> <state> <contract sha>
#               one per judge call whose prompt has the GOAL-JUDGE-PROMPT
#               header, in transcript order (rounds, frozen set, rubrics, and
#               contract)
#   V <tool_use_id> <judge> <score> <cache> <state> <model> <prompt_ok> <type_ok>
#   M <tool_use_id>   a result with more than one verdict block (ignored)
#
# Only Agent/Task results and their background notifications carry verdicts.
# Notifications are read from user rows, `attachment` rows (queued_command
# prompt), and `queue-operation` rows. prompt_ok is 1 when the call's prompt
# equals $canon[judge] (outer whitespace aside). model is the Agent `model`,
# else (none, empty, or "inherit") the calling turn's model, reduced to its
# family (opus, sonnet, ...). type_ok is 1 only for no `subagent_type` or
# `general-purpose`: a fork shares the runner's context, and a custom agent
# type brings its own system prompt that could steer the score.

def texts: if type == "string" then . elif type == "array" then map(texts) | join("\n")
  elif type == "object" then ((.text // .content // "") | texts) else "" end;
def trim: gsub("^\\s+|\\s+$"; "");
def family: ascii_downcase as $m
  | first(("opus", "sonnet", "haiku", "fable") as $f | select($m | contains($f)) | $f) // $m;
def header($k): (capture("(?m)^" + $k + ":[ \t]*(?<v>[^\r\n]*)").v // "") | trim;
# A field line in a verdict block; tolerates list, quote, and bold marks.
def f($k): "[ \t>*_-]*" + $k + "[*_]*:[*_ \t]*([^\r\n<*_][^\r\n<]*?)[*_ \t]*(?:\r?\n|(?=<)|$)";

[ inputs | fromjson? ] as $all
| ([ range(0; $all | length) as $i | $all[$i]
     | select(.type == "user") | .message.content | strings
     | select(test("^\\s*<command-name>/goal</command-name>"))
     | select((capture("<command-args>(?<a>[^<]*)</command-args>").a // "" | trim | ascii_downcase)
              | IN("", "clear", "stop", "off", "reset", "none", "cancel") | not)
     | $i ] | last // 0) as $start
| $all[$start:] as $rows
| ([ $rows[] | select(.type == "assistant") | (.message.model // "inherit") as $turn
     | .message.content[]? | select(.type == "tool_use") | select(.name == "Agent" or .name == "Task")
     | ((.input.prompt // "") | tostring) as $p
     | ((.input.model // "") | tostring) as $m
     | {key: .id, value: {
         prompt: $p,
         judge: (if ($p | test("^\\s*GOAL-JUDGE-PROMPT v[0-9]")) then ($p | header("Judge-Id") | ascii_downcase) else "" end),
         rubric: ($p | header("Rubric-SHA")), state: ($p | header("State")),
         contract: ($p | header("Contract-SHA")),
         model: ((if $m == "" or ($m | ascii_downcase) == "inherit" then $turn else $m end) | tostring | family),
         typeok: (if ((.input.subagent_type // "") | IN("", "general-purpose")) then "1" else "0" end),
         bg: (.input.run_in_background? == true) }} ]
   | from_entries) as $agents
| ([ $rows[]
     | if .type == "user" then (.message.content | if type == "string" then . else empty end)
       elif .type == "attachment" then (.attachment.prompt // .attachment.content // empty | texts)
       elif .type == "queue-operation" then (.content // empty | texts)
       else empty end
     | select(test("<task-notification>"))
     | {id: ((capture("<tool-use-id>(?<id>[^<]+)</tool-use-id>").id) // ""), text: .} ]) as $notes
| ([ $rows[] | select(.type == "user") | .message.content | arrays | .[]
     | select(.type? == "tool_result") | {id: .tool_use_id, text: (.content | texts)} ]) as $results
# Only judge calls can excuse a Stop: a launch is a judge call run in the
# background, or a judge call whose result starts with the launch line.
| ([ ($agents | to_entries[] | select(.value.judge != "" and .value.bg) | .key),
     ($results[] | select(($agents[.id].judge // "") != "")
       | select(.text | test("^\\s*Async agent launched")) | .id) ] | unique) as $launched
| ([ $notes[] | .id ] | unique) as $done
| "R\t\(($launched - $done) | length)",
  ( $agents | to_entries[] | select(.value.judge != "")
    | ["P", .key, .value.judge, .value.rubric, .value.state, .value.contract] | @tsv ),
  ( ($results + $notes)[] | select($agents[.id] != null)
    | .id as $id | $agents[$id] as $call
    | [ .text | scan("[*_]*GOAL-JUDGE-VERDICT[*_]*[ \t]*\r?\n" + f("Judge") + f("Score") + f("Cache") + f("State")) ] as $raw
    | [ $raw[] | map(trim | gsub("^`|`$"; "")) ] as $v
    | if ($v | length) > 1 then "M\t\($id)"
      elif ($v | length) == 1 then
        $v[0] as $x
        | ($x[1] | capture("^(?<n>[0-9]+(\\.[0-9]+)?)[ \t]*/[ \t]*10$").n // "bad") as $score
        | ($x[0] | ascii_downcase) as $judge
        | ((($call.prompt | trim) == (($canon[$judge] // "") | trim)) and ($canon[$judge] != null)) as $ok
        | ["V", $id, $judge, $score, $x[2], $x[3], $call.model, (if $ok then "1" else "0" end), $call.typeok] | @tsv
      else empty end )
