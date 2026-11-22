# Used by hooks/checks/goal-judges-before-stop.sh with `jq -R -r -n`.
# Input: a Claude Code transcript, read as raw lines (a torn last line is
# skipped, not fatal).
# Output, tab-separated:
#   R <n>                      background launches with no completion yet
#   V <tool_use_id> <judge> <score> <cache> <state> <model> <prompt_ok>
#   M <tool_use_id>            a result with more than one verdict block (ignored)
#
# Only Agent/Task results and their background notifications carry verdicts.
# Notifications are read from user rows, `attachment` rows (queued_command
# prompt), and `queue-operation` rows. prompt_ok is 1 when the call's prompt
# names the cache file and holds no pre-filled score.

def texts: if type == "string" then . elif type == "array" then map(texts) | join("\n")
  elif type == "object" then ((.text // .content // "") | texts) else "" end;

[ inputs | fromjson? ] as $rows
| ([ $rows[] | select(.type == "assistant") | .message.content[]?
     | select(.type == "tool_use") | select(.name == "Agent" or .name == "Task")
     | {key: .id, value: {prompt: ((.input.prompt // "") | tostring), model: (.input.model // "inherit")}} ]
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
# A launch is a call with run_in_background, or an Agent/Task result that
# starts with the launch line. Other output that only quotes it (a Bash
# command that prints hook source) is not a launch.
| ([ $rows[] | select(.type == "assistant") | .message.content[]?
     | select(.type == "tool_use") | select(.input.run_in_background? == true) | .id ]) as $bgcalls
| ([ ($bgcalls[]),
     ($results[] | select($agents[.id] != null) | select(.text | test("^\\s*Async agent launched")) | .id) ]
   | unique) as $launched
| ([ $notes[] | .id ] | unique) as $done
| "R\t\(($launched - $done) | length)",
  ( ($results + $notes)[] | select($agents[.id] != null)
    | .id as $id | $agents[$id] as $call
    | [ .text | scan("GOAL-JUDGE-VERDICT[ \t]*\r?\n[ \t]*Judge:[ \t]*([^\r\n<]+)\r?\n[ \t]*Score:[ \t]*([0-9]+(?:\\.[0-9]+)?)[ \t]*/[ \t]*10[ \t]*\r?\n[ \t]*Cache:[ \t]*([^\r\n<]+)\r?\n[ \t]*State:[ \t]*([^\r\n<]+)")
        | map(gsub("^\\s+|\\s+$"; "") | gsub("^`|`$"; "")) ] as $v
    | if ($v | length) > 1 then "M\t\($id)"
      elif ($v | length) == 1 then
        $v[0] as $x
        | (($call.prompt | contains($x[2])) and ($call.prompt | test("Score:[ \t]*[0-9]") | not)) as $ok
        | ["V", $id, ($x[0] | ascii_downcase), $x[1], $x[2], $x[3], ($call.model | tostring), (if $ok then "1" else "0" end)] | @tsv
      else empty end )
