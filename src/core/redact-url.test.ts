import { describe, expect, it } from "vitest";
import { errorMessage } from "./errors.js";
import { redactUrlCredentials, stripUrlCredentials } from "./redact-url.js";

describe("redactUrlCredentials", () => {
  it("hides https user info, password, and a bare token, wherever the URL sits in the text", () => {
    expect(redactUrlCredentials("Cloning https://alice:tok123@github.com/org/x.git...")).toBe(
      "Cloning https://***@github.com/org/x.git...",
    );
    expect(redactUrlCredentials("fatal: 'https://ghp_abc@github.com/o/r' not found")).toBe(
      "fatal: 'https://***@github.com/o/r' not found",
    );
    expect(redactUrlCredentials("http://u:p@h/x and https://t@h/y")).toBe("http://***@h/x and https://***@h/y");
    // An unencoded @ inside the password is still hidden.
    expect(redactUrlCredentials("https://u:p@ss@host/r")).toBe("https://***@host/r");
  });

  it("hides credentials in a colored URL (an ANSI code right before it)", () => {
    expect(redactUrlCredentials("\x1b[36mhttps://tok123@h/x\x1b[39m")).toBe("\x1b[36mhttps://***@h/x\x1b[39m");
    expect(redactUrlCredentials("\x1b[36mssh://git:secret@h/x")).toBe("\x1b[36mssh://git:***@h/x");
  });

  it("keeps an ssh user name but hides a password, and leaves scp-like and plain URLs alone", () => {
    expect(redactUrlCredentials("ssh://git@github.com/o/r.git")).toBe("ssh://git@github.com/o/r.git");
    expect(redactUrlCredentials("ssh://git:secret@host/r")).toBe("ssh://git:***@host/r");
    expect(redactUrlCredentials("git@github.com:o/r.git")).toBe("git@github.com:o/r.git");
    expect(redactUrlCredentials("https://github.com/o/r")).toBe("https://github.com/o/r");
  });
});

describe("stripUrlCredentials", () => {
  it("removes https credentials and an ssh password, and keeps the ssh user", () => {
    expect(stripUrlCredentials("https://alice:tok123@github.com/org/x.git")).toBe("https://github.com/org/x.git");
    expect(stripUrlCredentials("https://ghp_abc@github.com/o/r")).toBe("https://github.com/o/r");
    expect(stripUrlCredentials("ssh://git:secret@host/r")).toBe("ssh://git@host/r");
    expect(stripUrlCredentials("ssh://git@host/r")).toBe("ssh://git@host/r");
  });
});

describe("errorMessage", () => {
  it("never returns a credential from a URL in an error", () => {
    expect(errorMessage(new Error("git clone failed: https://u:tok123@h/x"))).not.toContain("tok123");
    expect(errorMessage("unable to access 'https://tok123@h/x/'")).not.toContain("tok123");
  });
});
