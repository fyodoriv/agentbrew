# Used by hooks/checks/goal-judges-before-stop.sh with
# `jq -R -r -n --argjson canon <{judge id: canonical prompt, "local:<id>":
# local prompt sha}> --arg lib <hook lib dir> --arg contract <contract path>
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
#   R <n>       judge launches (background) with no completion yet
#   P <tool_use_id> <judge> <rubric sha> <state> <contract sha>
#               one per judge call whose prompt has the GOAL-JUDGE-PROMPT
#               header, in transcript order (rounds, frozen set, rubrics, and
#               contract)
#   V <tool_use_id> <judge> <score> <cache> <state> <model> <prompt_ok> <type_ok> <messaged> <vendor>
#   T <family>  the runner's model family (its last turn), so the hook can
#               keep the runner's own model from holding a judge majority
#   M <tool_use_id>   a result with more than one verdict block (ignored)
#   U <tool_use_id>   an unofficial judge run: an Agent/Task call without the
#               header, or a `claude -p`/`codex exec` Bash call, whose text
#               holds the GOAL-JUDGE-PROMPT or GOAL-JUDGE-VERDICT marker, an
#               `ollama`/`llm`/port 11434 Bash call that builds a judge
#               prompt, or a goal-judge-local.sh call not in the official form
#
# Local judges: a Bash call that is exactly `bash <lib>/goal-judge-local.sh
# <contract> <judge id> <model>` (foreground, no other shell syntax) is a
# judge call. Its P row and verdict come from the script's printed header and
# answer; prompt_ok compares its Prompt-SHA with $canon["local:<id>"]; vendor
# comes from its model name. Agent/Task judges always run Claude models, so
# their vendor is anthropic whatever `model` says.
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
def vendor: ascii_downcase as $m
  | if ($m | test("claude|opus|sonnet|haiku|fable")) then "anthropic"
    elif ($m | test("qwen")) then "alibaba" elif ($m | test("llama")) then "meta"
    elif ($m | test("gemma|gemini")) then "google" elif ($m | test("gpt|^o[0-9]")) then "openai"
    elif ($m | test("mistral|mixtral|devstral|codestral")) then "mistral"
    elif ($m | test("deepseek")) then "deepseek" elif ($m | test("^phi")) then "microsoft" else $m end;
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
| ($lib + "/goal-judge-local.sh") as $localsh
| def words: .input.command // "" | tostring | trim | [splits("[ \t]+")] | map(gsub("^\"|\"$"; ""));
  def official: (.input.command // "" | tostring | trim | test("^bash[ \t]+[^;&|<>`$()\\\\\n]+$"))
    and (words as $w | ($w | length) == 5 and $w[1] == $localsh and $w[2] == $contract
         and ($w[3] | test("^[a-z0-9-]+$")))
    and (.input.run_in_background? != true);
  ([ $rows[] | select(.type == "assistant") | (.message.model // "inherit") as $turn
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
         bg: (.input.run_in_background? == true), vendor: "anthropic", local: false }} ]
   + [ $rows[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use")
       | select(.name == "Bash") | select(official)
       | words[3] as $cj
       | ($rtext[.id] // "") as $t
       | ($t | header("Model")) as $lm
       | {key: .id, value: {
           prompt: "", judge: (if ($t | header("Judge-Id") | ascii_downcase) == $cj then $cj else "" end),
           rubric: ($t | header("Rubric-SHA")), state: ($t | header("State")),
           contract: ($t | header("Contract-SHA")), psha: ($t | header("Prompt-SHA")),
           model: ($lm | ascii_downcase), vendor: ($lm | vendor), typeok: "1", name: "",
           bg: false, local: true }} ]
   | from_entries) as $agents
| ([ $rows[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use")
     | select(.name == "SendMessage") | (.input.to // "") | tostring | select(. != "") ] | unique) as $sent
| ([ $rows[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use")
     | select(
         ((.name == "Agent" or .name == "Task")
           and (((.input.prompt // "") | tostring) | test("^\\s*GOAL-JUDGE-PROMPT v[0-9]") | not)
           and (((.input.prompt // "") | tostring) | test("GOAL-JUDGE-(PROMPT|VERDICT)")))
         or (.name == "Bash"
           and (((.input.command // "") | tostring) | test("(^|[^A-Za-z0-9_-])(claude[ \t]+(-p|--print)|codex[ \t]+exec|ollama|llm)([^A-Za-z0-9_-]|$)|11434"))
           and (((.input.command // "") | tostring) | test("GOAL-JUDGE-(PROMPT|VERDICT)|goal-judge-(prompt|local)")))
         or (.name == "Bash" and (((.input.command // "") | tostring) | test("goal-judge-local\\.sh"))
           and (official | not)
           and (((.input.command // "") | tostring) | test("--prompt(-sha)?[ \t]") | not)))
     | .id ]) as $unofficial
| ([ $rows[]
     | if .type == "user" then (.message.content | if type == "string" then . else empty end)
       elif .type == "attachment" then (.attachment.prompt // .attachment.content // empty | texts)
       elif .type == "queue-operation" then (.content // empty | texts)
       else empty end
     | select(test("<task-notification>"))
     | {id: ((capture("<tool-use-id>(?<id>[^<]+)</tool-use-id>").id) // ""), text: .} ]) as $notes
# Only judge calls can excuse a Stop: a launch is a judge call run in the
# background, or a judge call whose result starts with the launch line.
| ([ ($agents | to_entries[] | select(.value.judge != "" and .value.bg) | .key),
     ($results[] | select(($agents[.id].judge // "") != "")
       | select(.text | test("^\\s*Async agent launched")) | .id) ] | unique) as $launched
| ([ $notes[] | .id ] | unique) as $done
| ([ $results[] | select(($agents[.id].judge // "") != "")
     | {key: .id, value: ((.text | capture("agentId:[ \t]*(?<a>[A-Za-z0-9_-]+)").a) // "")} ] | from_entries) as $agentid
| ([ $rows[] | select(.type == "assistant") | .message.model // empty | strings
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
        | (if $call.local then ($call.psha != "" and $call.psha == ($canon["local:" + $judge] // "") and $judge == $call.judge)
           else ((($call.prompt | trim) == (($canon[$judge] // "") | trim)) and ($canon[$judge] != null)) end) as $ok
        | (($agentid[$id] // "") as $aid
           | (($aid != "" and ($sent | index($aid)) != null)
              or ($call.name != "" and ($sent | index($call.name)) != null))) as $msg
        | ["V", $id, $judge, $score, $x[2], $x[3], $call.model, (if $ok then "1" else "0" end), $call.typeok,
           (if $msg then "1" else "0" end), $call.vendor] | @tsv
      else empty end )
  end
