# Used by hooks/checks/goal-judges-before-stop.sh with
# `jq -R -r -n --argjson canon <{judge id: canonical prompt}> --arg lib <hook lib dir> --arg contract <contract path>
# --arg mode <all|g>`. Mode g prints only the G row (the hook runs it on the
# grep-selected /goal command lines, so the full transcript is parsed once).
# Input: a Claude Code transcript, read as raw lines (a torn last line is
# skipped, not fatal). Only rows after the last `/goal <condition>` command
# count, so an earlier goal's judges never count for this one.
# Output, tab-separated:
#   G <active> <owner text, base64>
#               active is 1 when the last `/goal` command with an argument
#               set a goal (not clear/stop/...); the owner text is that
#               argument, read from the transcript the runner cannot edit
#   R <n>       judge launches (background) with no completion yet; only
#               a launch whose prompt is the exact official prompt counts
#   P <tool_use_id> <judge> <rubric sha> <state> <contract sha>
#               one per judge call whose prompt has the GOAL-JUDGE-PROMPT
#               header, in transcript order (rounds, frozen set, rubrics, and
#               contract)
#   V <tool_use_id> <judge> <score> <cache> <state> <model> <prompt_ok> <type_ok> <messaged> <header_ok>
#   T <family>  the runner's model family (its last turn), so the hook can
#               keep the runner's own model from holding a judge majority
#   M <tool_use_id>   a result with more than one verdict block (ignored)
#   U <tool_use_id>   an unofficial judge run: an Agent/Task call without the
#               header, or a Bash call that starts a model (`claude -p`,
#               `codex exec`, `ollama run`, `llm`, or an Ollama HTTP call, in
#               command position), whose result or notification holds a
#               filled-in verdict block (GOAL-JUDGE-VERDICT, Judge:, Score: N).
#               A review that only quotes the template produces no verdict, so
#               it never counts.
#
# Only Agent/Task results and their background notifications carry verdicts.
# Notifications are read from user rows, `attachment` rows (queued_command
# prompt), and `queue-operation` rows. prompt_ok is 1 when the call's prompt
# equals $canon[judge] (outer whitespace aside). model is the Agent `model`,
# else (none, empty, or "inherit") the calling turn's model, reduced to its
# family (opus, sonnet, ...). type_ok is 1 only for no `subagent_type` or
# `general-purpose`: a fork shares the runner's context, and a custom agent
# type brings its own system prompt that could steer the score. messaged is
# 1 when a SendMessage went to the judge's agent id (from its launch result)
# or name: a message can steer a running judge.

def texts: if type == "string" then . elif type == "array" then map(texts) | join("\n")
  elif type == "object" then ((.text // .content // "") | texts) else "" end;
def trim: gsub("^\\s+|\\s+$"; "");
def family: ascii_downcase as $m
  | first(("opus", "sonnet", "haiku", "fable") as $f | select($m | contains($f)) | $f) // $m;
# Drop `sh -n <file>` / `bash -n <file>` segments: a syntax check runs nothing.
def nocheck: gsub("(?<s>^|[;&|\n])[ \t]*(ba|z)?sh[ \t]+-n[ \t][^;&|\n]*"; "\(.s)");
def header($k): (capture("(?m)^" + $k + ":[ \t]*(?<v>[^\r\n]*)").v // "") | trim;
# A field line in a verdict block; tolerates list, quote, and bold marks.
def f($k): "[ \t>*_-]*" + $k + "[*_]*:[*_ \t]*([^\r\n<*_][^\r\n<]*?)[*_ \t]*(?:\r?\n|(?=<)|$)";

[ inputs | fromjson? ] as $all
| ([ range(0; $all | length) as $i | $all[$i]
     | select(.type == "user") | .message.content | strings
     | select(test("^\\s*<command-name>/goal</command-name>"))
     | select((capture("<command-args>(?<a>[\\s\\S]*?)</command-args>").a // "" | trim | ascii_downcase)
              | IN("", "clear", "stop", "off", "reset", "none", "cancel") | not)
     | $i ] | last // 0) as $start
| ([ $all[] | select(.type == "user") | .message.content | strings
     | select(test("^\\s*<command-name>/goal</command-name>"))
     | (capture("<command-args>(?<a>[\\s\\S]*?)</command-args>").a // "" | trim)
     | select(. != "") ] | last // "") as $lastargs
| ($lastargs != "" and ($lastargs | ascii_downcase | IN("clear", "stop", "off", "reset", "none", "cancel") | not)) as $active
| if $mode == "g" then "G\t\(if $active then 1 else 0 end)\t\($lastargs | @base64)" else
  $all[$start:] as $rows
| ([ $rows[] | select(.type == "user") | .message.content | arrays | .[]
     | select(.type? == "tool_result") | {id: .tool_use_id, text: (.content | texts)} ]) as $results
| ($results | map({key: .id, value: .text}) | from_entries) as $rtext
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
         name: ((.input.name // "") | tostring),
         bg: (.input.run_in_background? == true) }} ]
   | from_entries) as $agents
| ([ $rows[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use")
     | select(.name == "SendMessage") | (.input.to // "") | tostring | select(. != "") ] | unique) as $sent
| ([ $rows[]
     | if .type == "user" then (.message.content | if type == "string" then . else empty end)
       elif .type == "attachment" then (.attachment.prompt // .attachment.content // empty | texts)
       elif .type == "queue-operation" then (.content // empty | texts)
       else empty end
     | select(test("<task-notification>"))
     | {id: ((capture("<tool-use-id>(?<id>[^<]+)</tool-use-id>").id) // ""), text: .} ]) as $notes
| ($results + $notes | map(select(.id != ""))
   | group_by(.id) | map({key: .[0].id, value: (map(.text) | join("\n"))}) | from_entries) as $outs
| ("[*_]*GOAL-JUDGE-VERDICT[*_]*[ \t]*\r?\n" + f("Judge") + "[ \t>*_-]*Score[*_]*:[*_ \t]*[0-9]") as $filled
| ([ $rows[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use")
     | select(($outs[.id] // "") | test($filled))
     | select(
         ((.name == "Agent" or .name == "Task")
           and (((.input.prompt // "") | tostring) | test("^\\s*GOAL-JUDGE-PROMPT v[0-9]") | not))
         or (.name == "Bash"
           and (((.input.command // "") | tostring) | nocheck
                | test("(^|[;&|(`{\n]|\\$\\()[ \t]*(([A-Za-z_][A-Za-z0-9_]*=[^ \t]*|env|nohup|exec|time|command|sudo|timeout[ \t]+[^ \t]+)[ \t]+)*(claude[ \t]+([^;&|]*[ \t])?(-p|--print)|codex[ \t]+exec|ollama[ \t]+(run|generate)|llm)([^A-Za-z0-9_-]|$)|(curl|xh|http|wget)[^;&|]*(11434|/api/(generate|chat))"))))
     | .id ]) as $unofficial
# Only judge calls can excuse a Stop: a launch is a judge call run in the
# background, or a judge call whose result starts with the launch line.
| def official_prompt($a): ($a.judge != "") and ($canon[$a.judge] != null)
    and (($a.prompt | trim) == ($canon[$a.judge] | trim));
  ([ ($agents | to_entries[] | select(.value.bg and official_prompt(.value)) | .key),
     ($results[] | select($agents[.id] != null and official_prompt($agents[.id]))
       | select(.text | test("^\\s*Async agent launched")) | .id) ] | unique) as $launched
| ([ $notes[] | .id ] | unique) as $done
| ([ $results[] | select(($agents[.id].judge // "") != "")
     | {key: .id, value: ((.text | capture("agentId:[ \t]*(?<a>[A-Za-z0-9_-]+)").a) // "")} ] | from_entries) as $agentid
| ([ $rows[] | select(.type == "assistant" and (.isSidechain // false | not)) | .message.model // empty | strings
     | select(. != "<synthetic>") ] | last // "" | family) as $runner
| "G\t\(if $active then 1 else 0 end)\t\($lastargs | @base64)",
  "T\t\($runner)",
  "R\t\(($launched - $done) | length)",
  ( $unofficial[] | "U\t\(.)" ),
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
        | (($agentid[$id] // "") as $aid
           | (($aid != "" and ($sent | index($aid)) != null)
              or ($call.name != "" and ($sent | index($call.name)) != null))) as $msg
        | ["V", $id, $judge, $score, $x[2], $x[3], $call.model, (if $ok then "1" else "0" end), $call.typeok,
           (if $msg then "1" else "0" end),
           # Header bound to this verdict's own judge and state: an official
           # run of an earlier round (for the score history).
           (if ($call.prompt | test("^\\s*GOAL-JUDGE-PROMPT v[0-9]"))
               and ($call.prompt | contains("\nJudge-Id: " + $judge + "\n"))
               and ($call.prompt | contains("\nState: " + $x[3] + "\n")) then "1" else "0" end)] | @tsv
      else empty end )
  end
