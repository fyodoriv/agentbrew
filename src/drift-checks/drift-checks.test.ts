import { describe, expect, it } from "vitest";
import { checkAgentDefsDrift } from "./agents.js";
import { checkCommandsDrift, checkUserCreatedCommands } from "./commands.js";
import { checkInstructionsDrift } from "./instructions.js";
import { checkMcpDrift, checkMcpEnvVarsDrift, checkUserAddedMcpServers } from "./mcp.js";
import { checkRulesDrift } from "./rules.js";
import { checkBrokenSymlinks, checkSkillsDrift, checkSkillsValidity, checkUserCreatedSkills } from "./skills.js";

// These are runtime drift checks that read real agent configs on the
// current machine. We can't mock them easily without deep filesystem
// mocking, but we CAN verify they don't throw and return the right shape.

describe("drift-checks — return shape and no-throw", () => {
  it("checkAgentDefsDrift returns an array of DriftItem", () => {
    const result = checkAgentDefsDrift();
    expect(Array.isArray(result)).toBe(true);
    for (const item of result) {
      expect(item).toHaveProperty("agent");
      expect(item).toHaveProperty("type");
      expect(item).toHaveProperty("detail");
    }
  });

  it("checkCommandsDrift returns an array", () => {
    const result = checkCommandsDrift();
    expect(Array.isArray(result)).toBe(true);
  });

  it("checkUserCreatedCommands returns an array", () => {
    const result = checkUserCreatedCommands();
    expect(Array.isArray(result)).toBe(true);
  });

  it("checkInstructionsDrift returns an array", () => {
    const result = checkInstructionsDrift();
    expect(Array.isArray(result)).toBe(true);
  });

  it("checkMcpDrift returns an array", () => {
    const result = checkMcpDrift();
    expect(Array.isArray(result)).toBe(true);
  });

  it("checkMcpEnvVarsDrift returns an array", () => {
    const result = checkMcpEnvVarsDrift();
    expect(Array.isArray(result)).toBe(true);
  });

  it("checkUserAddedMcpServers returns an array", () => {
    const result = checkUserAddedMcpServers();
    expect(Array.isArray(result)).toBe(true);
  });

  it("checkRulesDrift returns an array", () => {
    const result = checkRulesDrift();
    expect(Array.isArray(result)).toBe(true);
  });

  it("checkSkillsDrift returns an array", () => {
    const result = checkSkillsDrift();
    expect(Array.isArray(result)).toBe(true);
  });

  it("checkBrokenSymlinks returns an array", () => {
    const result = checkBrokenSymlinks();
    expect(Array.isArray(result)).toBe(true);
  });

  it("checkSkillsValidity returns an array", () => {
    const result = checkSkillsValidity();
    expect(Array.isArray(result)).toBe(true);
  });

  it("checkUserCreatedSkills returns an array", () => {
    const result = checkUserCreatedSkills();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("drift-checks — type field correctness", () => {
  it("agent drift items have type 'agents'", () => {
    const result = checkAgentDefsDrift();
    for (const item of result) {
      expect(item.type).toBe("agents");
    }
  });

  it("command drift items have type 'commands'", () => {
    const result = checkCommandsDrift();
    for (const item of result) {
      expect(item.type).toBe("commands");
    }
  });

  it("user commands have type 'commands-user-added'", () => {
    const result = checkUserCreatedCommands();
    for (const item of result) {
      expect(item.type).toBe("commands-user-added");
    }
  });

  it("instruction drift items have type 'instructions'", () => {
    const result = checkInstructionsDrift();
    for (const item of result) {
      expect(item.type).toBe("instructions");
    }
  });

  // `checkRulesDrift` reports two distinct problems: a deployed rules file that
  // no longer matches the source (`rules`), and a source file carrying
  // duplicate rules (`rules-source`). Asserting a single type only passed while
  // this machine's shared-rules happened to be duplicate-free, so the test
  // failed the moment a real duplicate appeared.
  it("rules drift items use a rules drift type", () => {
    const result = checkRulesDrift();
    for (const item of result) {
      expect(["rules", "rules-source"]).toContain(item.type);
    }
  });
});
