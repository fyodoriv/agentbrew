import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const names = [
  "grades all four fixed synthetic decisions and passes the rule to each request",
  "detects wrong decisions and fails closed on malformed or failed transport",
  "binds candidate comparison to the pre-change receipt",
  "fails closed on transport, HTTP and malformed JSON failures",
  "requires the same resolved model digest",
  "rejects a model digest change during a cohort",
  "existing receipt blocks model requests",
  "interrupted attempt blocks retry",
  "concurrent attempts admit one",
  "complete receipt precedes report",
  "sync failure cannot finalize receipt",
  "inflight receipt stays unfinalized",
  "finalized receipt survives lost report",
  "orphan marker blocks model requests",
  "malformed marker rejected",
  "mismatched marker rejected",
];

const schemaNames = [
  "valid enum decisions",
  "exact request schema",
  "malformed JSON refused",
  "missing key refused",
  "extra key refused",
  "unknown enum refused",
  "non-string refused",
  "duplicate key refused",
  "HTTP failure refused",
  "transport failure refused",
];
const schemaGateNames = [
  "schema gate included",
  "complete schema report accepted",
  "missing duplicate or skipped schema rejected",
  "forged schema summary rejected",
];

function validateNamedTap(text, names) {
  const lines = text.split(/\r?\n/);
  const once = (line) => lines.filter((entry) => entry === line).length === 1;
  if (
    ![
      `1..${names.length}`,
      `# tests ${names.length}`,
      `# pass ${names.length}`,
      "# fail 0",
      "# cancelled 0",
      "# skipped 0",
      "# todo 0",
    ].every(once)
  ) {
    throw new Error("Incomplete chat-rule TAP summary");
  }
  for (const pattern of [
    /^1\.\.\d+$/,
    /^# tests \d+$/,
    /^# pass \d+$/,
    /^# fail \d+$/,
    /^# cancelled \d+$/,
    /^# skipped \d+$/,
    /^# todo \d+$/,
  ]) {
    if (lines.filter((line) => pattern.test(line)).length !== 1) throw new Error("Ambiguous chat-rule TAP summary");
  }
  const results = lines.filter((line) => /^(?:not )?ok \d+ - /.test(line));
  if (results.length !== names.length || names.some((name, index) => results[index] !== `ok ${index + 1} - ${name}`)) {
    throw new Error("Incomplete chat-rule TAP cases");
  }
}

export function validateChatRuleTap(text) {
  return validateNamedTap(text, names);
}
export function validateSchemaTap(text) {
  return validateNamedTap(text, schemaNames);
}
export function validateSchemaGateTap(text) {
  return validateNamedTap(text, schemaGateNames);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const text = readFileSync(process.argv[2], "utf8");
    if (process.argv[3] === "--schema") validateSchemaTap(text);
    else if (process.argv[3] === "--schema-gate") validateSchemaGateTap(text);
    else validateChatRuleTap(text);
    console.log("chat-rule TAP verified");
  } catch {
    console.error("chat-rule TAP rejected");
    process.exitCode = 1;
  }
}
