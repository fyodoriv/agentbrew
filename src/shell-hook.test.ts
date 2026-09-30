import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  appendFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock("write-file-atomic", () => ({
  sync: vi.fn(),
}));

vi.mock("./utils.js", () => ({
  expandHome: vi.fn((p: string) => p.replace("~", "/home/user")),
}));

import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { detectShell, installShellHook, isShellHookInstalled, uninstallShellHook } from "./shell-hook.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileAtomicSync);
const mockAppendFileSync = vi.mocked(appendFileSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockUnlinkSync = vi.mocked(unlinkSync);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Default to zsh
  vi.stubEnv("SHELL", "/bin/zsh");
});

describe("detectShell", () => {
  it("returns zsh for /bin/zsh", () => {
    vi.stubEnv("SHELL", "/bin/zsh");
    expect(detectShell()).toBe("zsh");
  });

  it("returns bash for /bin/bash", () => {
    vi.stubEnv("SHELL", "/bin/bash");
    expect(detectShell()).toBe("bash");
  });

  it("returns bash for /usr/bin/bash", () => {
    vi.stubEnv("SHELL", "/usr/bin/bash");
    expect(detectShell()).toBe("bash");
  });

  it("returns fish for /usr/bin/fish", () => {
    vi.stubEnv("SHELL", "/usr/bin/fish");
    expect(detectShell()).toBe("fish");
  });

  it("returns fish for /usr/local/bin/fish3", () => {
    vi.stubEnv("SHELL", "/usr/local/bin/fish3");
    expect(detectShell()).toBe("fish");
  });

  it("defaults to zsh when SHELL is unset", () => {
    vi.stubEnv("SHELL", "");
    expect(detectShell()).toBe("zsh");
  });
});

describe("isShellHookInstalled", () => {
  it("returns true when hook script exists", () => {
    mockExistsSync.mockReturnValue(true);
    expect(isShellHookInstalled()).toBe(true);
  });

  it("returns false when hook script does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(isShellHookInstalled()).toBe(false);
  });

  it("checks the correct path", () => {
    mockExistsSync.mockReturnValue(false);
    isShellHookInstalled();
    expect(mockExistsSync).toHaveBeenCalledWith("/home/user/.config/agentbrew/shell-hook.sh");
  });
});

describe("installShellHook", () => {
  it("creates the hook directory and writes the script", () => {
    mockExistsSync.mockReturnValue(false);
    installShellHook();
    expect(mockMkdirSync).toHaveBeenCalledWith("/home/user/.config/agentbrew", { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      "/home/user/.config/agentbrew/shell-hook.sh",
      expect.stringContaining("_agentbrew_detect"),
      "utf-8",
    );
  });

  it("hook script includes both zsh and bash support", () => {
    mockExistsSync.mockReturnValue(false);
    installShellHook();
    const script = mockWriteFileSync.mock.calls[0]?.[1] as string;
    expect(script).toContain("ZSH_VERSION");
    expect(script).toContain("add-zsh-hook chpwd");
    expect(script).toContain("BASH_VERSION");
    expect(script).toContain("PROMPT_COMMAND");
  });

  it("hook script includes Agentfile detection", () => {
    mockExistsSync.mockReturnValue(false);
    installShellHook();
    const script = mockWriteFileSync.mock.calls[0]?.[1] as string;
    expect(script).toContain("Agentfile");
    expect(script).toContain("_agentbrew_detect");
  });

  describe("zsh", () => {
    beforeEach(() => vi.stubEnv("SHELL", "/bin/zsh"));

    it("appends source line to .zshrc when guard is absent", () => {
      mockExistsSync.mockImplementation((p) => String(p).includes(".zshrc"));
      mockReadFileSync.mockReturnValue("# existing zshrc content\n");
      installShellHook();
      expect(mockAppendFileSync).toHaveBeenCalledWith(
        expect.stringContaining(".zshrc"),
        expect.stringContaining("shell-hook.sh"),
      );
    });

    it("skips .zshrc when guard is already present", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("# agentbrew shell hook\nsource foo\n");
      installShellHook();
      expect(mockAppendFileSync).not.toHaveBeenCalled();
    });

    it("does not append to .zshrc when file does not exist", () => {
      mockExistsSync.mockReturnValue(false);
      installShellHook();
      expect(mockAppendFileSync).not.toHaveBeenCalled();
    });

    it("prints restart hint for zsh", () => {
      mockExistsSync.mockReturnValue(false);
      installShellHook();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("source ~/.zshrc"));
    });
  });

  describe("bash", () => {
    beforeEach(() => vi.stubEnv("SHELL", "/bin/bash"));

    it("appends source line to .bashrc when it exists", () => {
      mockExistsSync.mockImplementation((p) => String(p).includes(".bashrc"));
      mockReadFileSync.mockReturnValue("# existing bashrc content\n");
      installShellHook();
      expect(mockAppendFileSync).toHaveBeenCalledWith(
        expect.stringContaining(".bashrc"),
        expect.stringContaining("shell-hook.sh"),
      );
    });

    it("falls back to .bash_profile when .bashrc does not exist", () => {
      mockExistsSync.mockImplementation((p) => String(p).includes(".bash_profile"));
      mockReadFileSync.mockReturnValue("# existing bash_profile content\n");
      installShellHook();
      expect(mockAppendFileSync).toHaveBeenCalledWith(
        expect.stringContaining(".bash_profile"),
        expect.stringContaining("shell-hook.sh"),
      );
    });

    it("prints restart hint for bash", () => {
      mockExistsSync.mockReturnValue(false);
      installShellHook();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("source ~/.bashrc"));
    });
  });

  describe("fish", () => {
    beforeEach(() => vi.stubEnv("SHELL", "/usr/bin/fish"));

    it("writes both sh and fish hook scripts", () => {
      mockExistsSync.mockReturnValue(false);
      installShellHook();
      const shWrite = mockWriteFileSync.mock.calls.find((c) => String(c[0]).includes("shell-hook.sh"));
      const fishWrite = mockWriteFileSync.mock.calls.find((c) => String(c[0]).includes("shell-hook.fish"));
      expect(shWrite).toBeDefined();
      expect(fishWrite).toBeDefined();
    });

    it("fish hook script uses native fish syntax", () => {
      mockExistsSync.mockReturnValue(false);
      installShellHook();
      const fishWrite = mockWriteFileSync.mock.calls.find((c) => String(c[0]).includes("shell-hook.fish"));
      const script = fishWrite?.[1] as string;
      expect(script).toContain("--on-variable PWD");
      expect(script).toContain("set -l found");
      expect(script).toContain("string join");
    });

    it("appends source line to config.fish when it exists", () => {
      mockExistsSync.mockImplementation((p) => String(p).includes("config.fish"));
      mockReadFileSync.mockReturnValue("# existing fish config\n");
      installShellHook();
      expect(mockAppendFileSync).toHaveBeenCalledWith(
        expect.stringContaining("config.fish"),
        expect.stringContaining("shell-hook.fish"),
      );
    });

    it("prints restart hint for fish", () => {
      mockExistsSync.mockReturnValue(false);
      installShellHook();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining("source ~/.config/fish/config.fish"));
    });
  });
});

describe("uninstallShellHook", () => {
  it("removes the hook script when it exists", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("some content\n");
    uninstallShellHook();
    expect(mockUnlinkSync).toHaveBeenCalledWith("/home/user/.config/agentbrew/shell-hook.sh");
  });

  it("removes the fish hook script when it exists", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("some content\n");
    uninstallShellHook();
    expect(mockUnlinkSync).toHaveBeenCalledWith("/home/user/.config/agentbrew/shell-hook.fish");
  });

  it("does not call unlinkSync when hooks do not exist", () => {
    mockExistsSync.mockReturnValue(false);
    uninstallShellHook();
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });

  it("removes guard and source lines from .zshrc", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      '# before\n# agentbrew shell hook\nsource "/home/user/.config/agentbrew/shell-hook.sh"\n# after\n',
    );
    uninstallShellHook();
    const written = mockWriteFileSync.mock.calls.find((c) => String(c[0]).includes(".zshrc"));
    expect(written).toBeDefined();
    const cleaned = written?.[1] as string;
    expect(cleaned).not.toContain("agentbrew shell hook");
    expect(cleaned).not.toContain("shell-hook.sh");
    expect(cleaned).toContain("# before");
    expect(cleaned).toContain("# after");
  });

  it("removes guard and source lines from .bashrc", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      '# before\n# agentbrew shell hook\nsource "/home/user/.config/agentbrew/shell-hook.sh"\n# after\n',
    );
    uninstallShellHook();
    const written = mockWriteFileSync.mock.calls.find((c) => String(c[0]).includes(".bashrc"));
    expect(written).toBeDefined();
  });

  it("removes guard and source lines from config.fish", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      '# before\n# agentbrew shell hook\nsource "/home/user/.config/agentbrew/shell-hook.fish"\n# after\n',
    );
    uninstallShellHook();
    const written = mockWriteFileSync.mock.calls.find((c) => String(c[0]).includes("config.fish"));
    expect(written).toBeDefined();
    const cleaned = written?.[1] as string;
    expect(cleaned).not.toContain("agentbrew shell hook");
    expect(cleaned).not.toContain("shell-hook.fish");
  });

  it("does not rewrite rc file when guard is absent", () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path.includes("shell-hook.sh") || path.includes("shell-hook.fish");
    });
    // No rc files exist
    uninstallShellHook();
    // Only the unlinkSync calls should have happened, no writeFileSync for rc files
    const rcWrites = mockWriteFileSync.mock.calls.filter(
      (c) =>
        String(c[0]).includes(".zshrc") || String(c[0]).includes(".bashrc") || String(c[0]).includes("config.fish"),
    );
    expect(rcWrites).toHaveLength(0);
  });
});
