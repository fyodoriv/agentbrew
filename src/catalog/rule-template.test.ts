import { describe, expect, it } from "vitest";
import { applyRuleTemplate, resolveTemplateVars } from "./rule-template.js";

// All resolveUserName edge cases ride through `resolveTemplateVars` so the
// tests pin the public API surface that callers (src/catalog/install-other.ts)
// actually use. Same shape as PR #921 (`detectSecretsInRecord`/`InArgs`
// migrated): the helper stayed alive only because tests imported it directly.

describe("resolveTemplateVars — user_name resolution", () => {
  it("prefers AGENTBREW_USER_NAME env var when set", () => {
    const vars = resolveTemplateVars({
      env: { AGENTBREW_USER_NAME: "Explicit Override", USER: "shouldnotbeused" },
      gitName: "Should Notbeused",
    });
    expect(vars.user_name).toBe("Explicit Override");
  });

  it("uses first word of git config user.name when env override is absent", () => {
    const vars = resolveTemplateVars({
      env: { USER: "alice" },
      gitName: "Fyodor Ivanischev",
    });
    expect(vars.user_name).toBe("Fyodor");
  });

  it("uses whole git name when it is a single word", () => {
    const vars = resolveTemplateVars({
      env: {},
      gitName: "Cher",
    });
    expect(vars.user_name).toBe("Cher");
  });

  it("falls back to $USER when git name is missing", () => {
    const vars = resolveTemplateVars({
      env: { USER: "alice" },
      gitName: undefined,
    });
    expect(vars.user_name).toBe("alice");
  });

  it('falls back to "the user" when everything is missing', () => {
    const vars = resolveTemplateVars({ env: {}, gitName: undefined });
    expect(vars.user_name).toBe("the user");
  });

  it("treats empty strings as unset", () => {
    const vars = resolveTemplateVars({
      env: { AGENTBREW_USER_NAME: "", USER: "" },
      gitName: "",
    });
    expect(vars.user_name).toBe("the user");
  });

  it("trims whitespace on git name before splitting", () => {
    const vars = resolveTemplateVars({
      env: {},
      gitName: "  Fyodor Ivanischev  ",
    });
    expect(vars.user_name).toBe("Fyodor");
  });
});

describe("applyRuleTemplate", () => {
  it("substitutes {{ user_name }} with the resolved name", () => {
    const content = "Written by an agent, not {{ user_name }}. Ping me if off.";
    const result = applyRuleTemplate(content, { user_name: "Fyodor" });
    expect(result).toBe("Written by an agent, not Fyodor. Ping me if off.");
  });

  it("substitutes every occurrence", () => {
    const content = "{{ user_name }} told the agent to notify {{ user_name }} later.";
    const result = applyRuleTemplate(content, { user_name: "Fyodor" });
    expect(result).toBe("Fyodor told the agent to notify Fyodor later.");
  });

  it("is tolerant of whitespace inside the braces", () => {
    const content = "A: {{user_name}}, B: {{ user_name }}, C: {{  user_name  }}";
    const result = applyRuleTemplate(content, { user_name: "Fyodor" });
    expect(result).toBe("A: Fyodor, B: Fyodor, C: Fyodor");
  });

  it("leaves content untouched when no template variables are present", () => {
    const content = "Run tests before every commit.";
    expect(applyRuleTemplate(content, { user_name: "Fyodor" })).toBe(content);
  });

  it("leaves unknown template variables intact (not silently blanked)", () => {
    const content = "Hi {{ user_name }}, your role is {{ role }}.";
    const result = applyRuleTemplate(content, { user_name: "Fyodor" });
    expect(result).toBe("Hi Fyodor, your role is {{ role }}.");
  });
});
