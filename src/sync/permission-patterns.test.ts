import { describe, expect, it } from "vitest";
import {
  findFileWritePermissionPatterns,
  findLegacyShellPermissionPatterns,
  findMalformedPermissionPatterns,
  isLegacyShellPermissionPattern,
  migrateFileWritePermissionPattern,
  migrateLegacyShellPermissionMarkdown,
  migrateLegacyShellPermissionPattern,
  migrateLegacyShellPermissionSettings,
  repairMalformedPermissionPattern,
} from "./permission-patterns.js";

describe("migrateLegacyShellPermissionPattern", () => {
  it("rewrites Exec(...) to Bash(...)", () => {
    expect(migrateLegacyShellPermissionPattern("Exec(sudo *)")).toBe("Bash(sudo *)");
    expect(migrateLegacyShellPermissionPattern("Exec(gh repo create *)")).toBe("Bash(gh repo create *)");
    expect(migrateLegacyShellPermissionPattern("Exec(rm -rf /)*")).toBe("Bash(rm -rf /*)");
  });

  it("rewrites Shell(...) to Bash(...)", () => {
    expect(migrateLegacyShellPermissionPattern("Shell(ls)")).toBe("Bash(ls)");
  });

  it("leaves Bash(...) and non-shell patterns unchanged", () => {
    expect(migrateLegacyShellPermissionPattern("Bash(git *)")).toBe("Bash(git *)");
    expect(migrateLegacyShellPermissionPattern("Read(**)")).toBe("Read(**)");
    expect(migrateLegacyShellPermissionPattern("mcp__github__*")).toBe("mcp__github__*");
  });
});

describe("repairMalformedPermissionPattern", () => {
  it("moves a trailing glob inside the closing paren", () => {
    expect(repairMalformedPermissionPattern("Bash(rm -rf /)*")).toBe("Bash(rm -rf /*)");
    expect(repairMalformedPermissionPattern("Bash(rm -rf ~)*")).toBe("Bash(rm -rf ~*)");
  });

  it("leaves well-formed patterns unchanged", () => {
    expect(repairMalformedPermissionPattern("Bash(sudo *)")).toBe("Bash(sudo *)");
    expect(repairMalformedPermissionPattern("Bash(npm publish*)")).toBe("Bash(npm publish*)");
    expect(repairMalformedPermissionPattern("Bash")).toBe("Bash");
    expect(repairMalformedPermissionPattern("mcp__github__*")).toBe("mcp__github__*");
  });

  it("leaves ambiguous trailing content unchanged", () => {
    expect(repairMalformedPermissionPattern("Bash(foo)*bar")).toBe("Bash(foo)*bar");
    expect(repairMalformedPermissionPattern("Bash(foo)bar")).toBe("Bash(foo)bar");
  });

  it("preserves literal parens inside the content", () => {
    expect(repairMalformedPermissionPattern("Bash(echo (hi))*")).toBe("Bash(echo (hi)*)");
  });
});

describe("findMalformedPermissionPatterns", () => {
  it("lists malformed entries with allow/deny prefix", () => {
    const settings = {
      permissions: {
        allow: ["Bash(git *)"],
        deny: ["Bash(rm -rf /)*", "Bash(sudo *)"],
      },
    };
    expect(findMalformedPermissionPatterns(settings)).toEqual(["deny: Bash(rm -rf /)*"]);
  });
});

describe("migrateLegacyShellPermissionSettings", () => {
  it("migrates allow and deny arrays in settings.permissions", () => {
    const settings = {
      permissions: {
        allow: ["Read(**)", "Exec(git *)", "Shell(ls)"],
        deny: ["Exec(sudo *)", "Exec(npm publish*)", "mcp__atlassian__create_issue"],
      },
    };
    expect(migrateLegacyShellPermissionSettings(settings)).toBe(true);
    expect(settings.permissions).toEqual({
      allow: ["Read(**)", "Bash(git *)", "Bash(ls)"],
      deny: ["Bash(sudo *)", "Bash(npm publish*)", "mcp__atlassian__create_issue"],
    });
  });

  it("repairs malformed patterns alongside the prefix migration", () => {
    const settings = {
      permissions: {
        deny: ["Exec(rm -rf /)*", "Bash(rm -rf ~)*"],
      },
    };
    expect(migrateLegacyShellPermissionSettings(settings)).toBe(true);
    expect(settings.permissions.deny).toEqual(["Bash(rm -rf /*)", "Bash(rm -rf ~*)"]);
  });

  it("returns false when nothing to migrate", () => {
    const settings = {
      permissions: {
        allow: ["Bash(git *)"],
        deny: ["Bash(sudo *)"],
      },
    };
    expect(migrateLegacyShellPermissionSettings(settings)).toBe(false);
  });
});

describe("findLegacyShellPermissionPatterns", () => {
  it("lists stale patterns with allow/deny prefix", () => {
    const settings = {
      permissions: {
        allow: ["Exec(git *)"],
        deny: ["Exec(sudo *)"],
      },
    };
    expect(findLegacyShellPermissionPatterns(settings)).toEqual(["allow: Exec(git *)", "deny: Exec(sudo *)"]);
  });
});

describe("isLegacyShellPermissionPattern", () => {
  it("detects Exec and Shell prefixes only", () => {
    expect(isLegacyShellPermissionPattern("Exec(chmod 777 *)")).toBe(true);
    expect(isLegacyShellPermissionPattern("Shell(cat *)")).toBe(true);
    expect(isLegacyShellPermissionPattern("Bash(cat *)")).toBe(false);
  });
});

describe("migrateLegacyShellPermissionMarkdown", () => {
  it("rewrites legacy Exec/Shell patterns inside agent markdown", () => {
    const input = "permissions:\n  allow:\n    - Exec(git *)\n    - Shell(ls)\n";
    expect(migrateLegacyShellPermissionMarkdown(input)).toBe(
      "permissions:\n  allow:\n    - Bash(git *)\n    - Bash(ls)\n",
    );
  });
});

describe("migrateFileWritePermissionPattern", () => {
  it("rewrites Write(path) to Edit(path)", () => {
    expect(migrateFileWritePermissionPattern("Write(~/.claude/**)")).toBe("Edit(~/.claude/**)");
    expect(migrateFileWritePermissionPattern("Write(~/apps/**)")).toBe("Edit(~/apps/**)");
  });

  it("leaves a bare Write rule unchanged", () => {
    expect(migrateFileWritePermissionPattern("Write")).toBe("Write");
  });

  it("leaves non-Write patterns unchanged", () => {
    expect(migrateFileWritePermissionPattern("Edit(~/apps/**)")).toBe("Edit(~/apps/**)");
    expect(migrateFileWritePermissionPattern("Read(**)")).toBe("Read(**)");
    expect(migrateFileWritePermissionPattern("Bash(git *)")).toBe("Bash(git *)");
    expect(migrateFileWritePermissionPattern("WriteFoo(x)")).toBe("WriteFoo(x)");
  });

  it("drops a Write(path) rule that duplicates an existing Edit(path) rule", () => {
    const settings = {
      permissions: { allow: ["Edit(~/apps/**)", "Write(~/apps/**)", "Read(**)"] },
    };
    expect(migrateLegacyShellPermissionSettings(settings)).toBe(true);
    expect(settings.permissions.allow).toEqual(["Edit(~/apps/**)", "Read(**)"]);
  });

  it("migrates Write(path) entries inside settings allow and deny", () => {
    const settings = {
      permissions: {
        allow: ["Write(~/.claude/**)", "Read(**)"],
        deny: ["Write(~/.ssh/**)"],
      },
    };
    expect(migrateLegacyShellPermissionSettings(settings)).toBe(true);
    expect(settings.permissions.allow).toEqual(["Edit(~/.claude/**)", "Read(**)"]);
    expect(settings.permissions.deny).toEqual(["Edit(~/.ssh/**)"]);
  });
});

describe("findFileWritePermissionPatterns", () => {
  it("lists Write(path) entries with allow/deny prefix", () => {
    const settings = {
      permissions: {
        allow: ["Write(~/apps/**)", "Edit(~/apps/**)", "Write"],
        deny: ["Write(~/.ssh/**)"],
      },
    };
    expect(findFileWritePermissionPatterns(settings)).toEqual(["allow: Write(~/apps/**)", "deny: Write(~/.ssh/**)"]);
  });

  it("returns nothing when no Write(path) rules remain", () => {
    expect(findFileWritePermissionPatterns({ permissions: { allow: ["Edit(~/apps/**)", "Write"] } })).toEqual([]);
  });
});
