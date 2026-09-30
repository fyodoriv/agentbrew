import type { AnySchema, ErrorObject, ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import claudeCodeSchema from "./schemas/claude-code.schema.json";
import devinSchema from "./schemas/devin.schema.json";
import opencodeSchema from "./schemas/opencode.schema.json";

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validatorCache = new Map<string, ValidateFunction | undefined>();
const ENTRY_SCHEMAS: Record<string, AnySchema> = {
  "claude-code": claudeCodeSchema,
  devin: devinSchema,
  opencode: opencodeSchema,
};

function validatorFor(agentName: string): ValidateFunction | undefined {
  if (validatorCache.has(agentName)) return validatorCache.get(agentName);
  const schema = ENTRY_SCHEMAS[agentName];
  if (!schema) {
    validatorCache.set(agentName, undefined);
    return undefined;
  }
  const validator = ajv.compile(schema);
  validatorCache.set(agentName, validator);
  return validator;
}

function formatError(error: ErrorObject): string {
  const path = error.instancePath || "(root)";
  return `${path} ${error.message ?? "is invalid"}`;
}

export function validateMcpEntryAgainstSchema(
  agentName: string,
  serverName: string,
  entry: Record<string, unknown>,
): string | undefined {
  const validator = validatorFor(agentName);
  if (!validator || validator(entry)) return undefined;
  const details = (validator.errors ?? []).map(formatError).join("; ");
  return `schema validation failed for ${agentName}.${serverName}: ${details}`;
}

export function validateMcpEntriesAgainstSchema(
  agentName: string,
  entries: Record<string, Record<string, unknown>>,
): string | undefined {
  const failures = Object.entries(entries)
    .map(([serverName, entry]) => validateMcpEntryAgainstSchema(agentName, serverName, entry))
    .filter((error): error is string => error !== undefined);
  return failures.length > 0 ? failures.join("\n") : undefined;
}
