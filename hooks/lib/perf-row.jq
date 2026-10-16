# agentbrew/hooks/lib/perf-row.jq
#
# Builds one agent perf log row from a Claude Code hook payload.
# Used by hooks/checks/perf-record.sh. Events: PostToolUse and
# PostToolUseFailure (tool row), PreToolUse (attempt row), PermissionDenied
# (denied row), UserPromptSubmit (turn row). Output is three lines:
#   1. the payload cwd (the shell maps it to a project name)
#   2. the UTC month (YYYY-MM), which names the log file
#   3. the row as JSON, without its leading "{" and without "project"
# Other events produce no output.
#
# Privacy: the row keeps only a step key. Each kept word must match
# word_ok; a path keeps only a script file name; anything else is <arg>.

def word_ok: test("^(-{1,2})?[A-Za-z0-9][A-Za-z0-9._:@+-]{0,39}$");

def tokenish:
  (length >= 20 and test("[0-9]"))
  or test("^(ghp_|gho_|ghs_|github_pat_|sk-|xox[a-z]-|AKIA)");

def clean_word:
  sub("[);&|]+$"; "")
  | if test("/") then
    (split("/") | last) as $base
    | if ($base | test("^[A-Za-z0-9][A-Za-z0-9._-]{0,39}\\.(sh|bash|mjs|cjs|js|ts|py|rb)$"))
      then $base else "<path>" end
  elif test("=") then (split("=")[0] | if word_ok then . + "=" else "<arg>" end)
  elif tokenish then "<redacted>"
  elif word_ok then .
  else "<arg>" end;

# Drop prefixes that hide the real command: "(", "cd X &&", VAR=value,
# env/nice/time/nohup/command/exec/timeout wrappers and their flags.
def strip:
  if test("^[({]\\s*") then sub("^[({]\\s*"; "") | strip
  elif test("^cd\\s+[^;&|]*?\\s*(&&|;)\\s*") then sub("^cd\\s+[^;&|]*?\\s*(&&|;)\\s*"; "") | strip
  elif test("^[A-Za-z_][A-Za-z0-9_]*=(\"[^\"]*\"|'[^']*'|\\S*)\\s+") then
    sub("^[A-Za-z_][A-Za-z0-9_]*=(\"[^\"]*\"|'[^']*'|\\S*)\\s+"; "") | strip
  elif test("^(\\S*/)?(env|nice|time|nohup|command|exec|timeout)\\s+") then
    sub("^(\\S*/)?(env|nice|time|nohup|command|exec|timeout)\\s+"; "") | strip
  elif test("^-[unCSks]\\s+\\S+\\s+") then sub("^-[unCSks]\\s+\\S+\\s+"; "") | strip
  elif test("^-\\S*\\s+") then sub("^-\\S*\\s+"; "") | strip
  elif test("^[0-9]+[smhd]?\\s+") then sub("^[0-9]+[smhd]?\\s+"; "") | strip
  else . end;

def bash_key:
  ((.tool_input.command // "") | tostring | (split("\n") | .[0] // "") | sub("^\\s+"; "") | strip
   | [splits("\\s+")] | map(select(length > 0))) as $w
  | if ($w | length) == 0 then "Bash"
    else ($w[0] | clean_word) as $a
      | if ($w | length) == 1 then $a
        else ($w[1] | clean_word) as $b
          | if $b == "run" and ($w | length) > 2 then "\($a) run \($w[2] | clean_word)" else "\($a) \($b)" end
        end
    end;

def ext_key($tool):
  ((.tool_input.file_path // .tool_input.notebook_path // "") | tostring | split("/") | last) as $base
  | ($base | if test("\\.[A-Za-z0-9]{1,10}$") then (split(".") | last | ascii_downcase) else "none" end) as $ext
  | "\($tool):\($ext)";

def safe_name: tostring | gsub("[^A-Za-z0-9:_.-]"; "_") | .[0:80];

def step_key:
  (.tool_name // "unknown") as $t
  | if $t == "Bash" then bash_key
    elif ($t | test("^(Edit|Write|Read|MultiEdit|NotebookEdit)$")) then ext_key($t)
    elif $t == "Agent" or $t == "Task" then "agent:" + ((.tool_input.subagent_type // "general-purpose") | safe_name)
    elif $t == "Skill" then "skill:" + ((.tool_input.skill // .tool_input.command // "unknown") | safe_name)
    else ($t | safe_name) end;

# tool_use_id pairs an attempt row with its completion row. It is opaque.
def call_id: (.tool_use_id // "") | tostring | gsub("[^A-Za-z0-9_-]"; "") | .[0:64];

def agent_name: if .agent_type == null then null else (.agent_type | safe_name) end;

(.cwd // "" | tostring) as $cwd
| now as $now
| ($now | todate) as $ts
| ($now | strftime("%Y-%m")) as $month
| ((.session_id // "") | tostring | gsub("[^A-Za-z0-9_-]"; "")) as $sid
| if .hook_event_name == "UserPromptSubmit" then
    $cwd, $month, ({ts: $ts, sid: $sid, ev: "turn"} | tojson | .[1:])
  elif .hook_event_name == "PostToolUse" or .hook_event_name == "PostToolUseFailure" then
    $cwd, $month,
    ({ts: $ts, sid: $sid, tool: ((.tool_name // "unknown") | safe_name),
      ms: (if (.duration_ms | type) == "number" then .duration_ms else null end),
      ok: (.hook_event_name == "PostToolUse"),
      key: step_key, id: call_id, agent: agent_name}
     | tojson | .[1:])
  elif .hook_event_name == "PreToolUse" or .hook_event_name == "PermissionDenied" then
    $cwd, $month,
    ({ts: $ts, sid: $sid, ev: (if .hook_event_name == "PreToolUse" then "attempt" else "denied" end),
      tool: ((.tool_name // "unknown") | safe_name), key: step_key, id: call_id, agent: agent_name}
     | tojson | .[1:])
  else empty end
