# Used by hooks/checks/goal-judges-before-stop.sh with `jq -r -s`.
# Input: a Claude Code transcript (JSONL, slurped).
# Args: $state (run-goal state folder + "/"), $judges (judge cache + "/").
# Output: one TSV row per judge (lowercase id, latest score, cache path),
# from verdicts after the last file edit that is not a state or cache write.
# Only Agent/Task tool results and background-task notifications count.

def texts: if type == "string" then . elif type == "array" then map(texts) | join("\n")
  elif type == "object" then ((.text // .content // "") | texts) else "" end;

to_entries as $e
| ([ $e[] | select(.value.type == "assistant") | .value.message.content[]?
     | select(.type == "tool_use") | select(.name == "Agent" or .name == "Task") | .id ]) as $agents
| ([ $e[] | select(.value.type == "assistant")
     | . as $row | $row.value.message.content[]?
     | select(.type == "tool_use")
     | select(.name == "Edit" or .name == "Write" or .name == "MultiEdit" or .name == "NotebookEdit")
     | (.input.file_path // .input.notebook_path // "")
     | select((startswith($state) or startswith($judges)) | not)
     | $row.key ] | max // -1) as $lastEdit
| [ $e[] | select(.key > $lastEdit) | select(.value.type == "user") | .value.message.content
    | if type == "array" then
        (.[] | select(.type? == "tool_result")
         | select(.tool_use_id as $id | $agents | index($id)) | (.content | texts))
      else (texts | select(test("<task-notification>"))
            | select(((capture("<tool-use-id>(?<id>[^<]+)</tool-use-id>").id) // "") as $id | $agents | index($id))) end ]
| [ .[] | scan("GOAL-JUDGE-VERDICT[ \t]*\r?\n[ \t]*Judge:[ \t]*([^\r\n]+)\r?\n[ \t]*Score:[ \t]*([0-9]+(?:\\.[0-9]+)?)[ \t]*/[ \t]*10[ \t]*\r?\n[ \t]*Cache:[ \t]*([^\r\n<]+)")
    | map(gsub("^\\s+|\\s+$"; "") | gsub("^`|`$"; "")) ]
| to_entries
| group_by(.value[0] | ascii_downcase)
| map(max_by(.key).value | [(.[0] | ascii_downcase), .[1], .[2]])
| .[] | @tsv
