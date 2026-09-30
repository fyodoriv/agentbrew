import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  realpathSync: vi.fn(),
}));

vi.mock("../utils.js", () => ({
  expandHome: vi.fn((p: string) => p.replace("~", "/mock-home")),
}));

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import {
  AUTO_SYNC_INTERVAL_MINUTES,
  AUTO_SYNC_INTERVAL_SECONDS,
  buildLaunchAgentFixArgs,
  buildLaunchAgentPath,
  getAgentBrewBin,
  getLogDir,
  getNodeBinDir,
  launchAgentPathHasRequiredPrefixes,
  requiredLaunchAgentPathPrefixes,
  resolveAgentBrewCliJsPath,
  resolveDotfilesBinPath,
} from "./scheduler-paths.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DOTFILES_DIR", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("constants", () => {
  it("AUTO_SYNC_INTERVAL_MINUTES is 30", () => {
    expect(AUTO_SYNC_INTERVAL_MINUTES).toBe(30);
  });

  it("AUTO_SYNC_INTERVAL_SECONDS equals minutes * 60", () => {
    expect(AUTO_SYNC_INTERVAL_SECONDS).toBe(AUTO_SYNC_INTERVAL_MINUTES * 60);
  });
});

describe("getLogDir", () => {
  it("returns expanded log directory path", () => {
    expect(getLogDir()).toBe("/mock-home/.local/share/agentbrew/logs");
  });
});

describe("getNodeBinDir", () => {
  it("returns the directory containing the current Node binary", () => {
    const result = getNodeBinDir();
    expect(result).toBe(require("node:path").dirname(process.execPath));
  });

  it("returns a non-empty string", () => {
    expect(getNodeBinDir().length).toBeGreaterThan(0);
  });
});

describe("getAgentBrewBin", () => {
  it("returns path from `which` when available and file exists", () => {
    vi.mocked(execFileSync).mockReturnValue(Buffer.from("/usr/local/bin/agentbrew\n"));
    vi.mocked(existsSync).mockReturnValue(true);
    expect(getAgentBrewBin()).toBe("/usr/local/bin/agentbrew");
  });

  it("falls back to process.argv[1] when `which` fails", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("not found");
    });
    const original = process.argv[1];
    process.argv[1] = "/opt/bin/agentbrew";
    vi.mocked(existsSync).mockReturnValue(true);
    try {
      expect(getAgentBrewBin()).toBe("/opt/bin/agentbrew");
    } finally {
      process.argv[1] = original;
    }
  });

  it("falls back to process.argv[1] when `which` returns non-existent path", () => {
    vi.mocked(execFileSync).mockReturnValue(Buffer.from("/gone/agentbrew\n"));
    vi.mocked(existsSync).mockImplementation((p) => {
      if (String(p) === "/gone/agentbrew") return false;
      return true; // process.argv[1]
    });
    const original = process.argv[1];
    process.argv[1] = "/real/agentbrew";
    try {
      expect(getAgentBrewBin()).toBe("/real/agentbrew");
    } finally {
      process.argv[1] = original;
    }
  });

  it("returns default path when both `which` and argv[1] fail", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("not found");
    });
    const original = process.argv[1];
    process.argv[1] = "";
    vi.mocked(existsSync).mockReturnValue(false);
    try {
      expect(getAgentBrewBin()).toBe("/mock-home/.local/bin/agentbrew");
    } finally {
      process.argv[1] = original;
    }
  });

  it("returns default path when argv[1] file does not exist", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("not found");
    });
    const original = process.argv[1];
    process.argv[1] = "/missing/agentbrew";
    vi.mocked(existsSync).mockReturnValue(false);
    try {
      expect(getAgentBrewBin()).toBe("/mock-home/.local/bin/agentbrew");
    } finally {
      process.argv[1] = original;
    }
  });
});

describe("resolveAgentBrewCliJsPath", () => {
  it("returns dist/cli.js when process.argv[1] is the built entry", () => {
    const original = process.argv[1];
    process.argv[1] = "/repo/agentbrew/dist/cli.js";
    vi.mocked(existsSync).mockReturnValue(true);
    try {
      expect(resolveAgentBrewCliJsPath()).toBe("/repo/agentbrew/dist/cli.js");
    } finally {
      process.argv[1] = original;
    }
  });

  it("resolves npm-global symlink to dist/cli.js", () => {
    vi.mocked(execFileSync).mockReturnValue(Buffer.from("/mock-home/.local/bin/agentbrew\n"));
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(realpathSync).mockReturnValue(
      "/mock-home/.local/share/fnm/node-versions/v22.0.0/installation/lib/node_modules/agentbrew/dist/cli.js",
    );
    const original = process.argv[1];
    process.argv[1] = "";
    try {
      expect(resolveAgentBrewCliJsPath()).toContain("dist/cli.js");
    } finally {
      process.argv[1] = original;
    }
  });
});

describe("buildLaunchAgentFixArgs", () => {
  it("returns node execPath, cli.js path, and fix subcommand", () => {
    const original = process.argv[1];
    process.argv[1] = "/repo/agentbrew/dist/cli.js";
    vi.mocked(existsSync).mockReturnValue(true);
    try {
      expect(buildLaunchAgentFixArgs()).toEqual([process.execPath, "/repo/agentbrew/dist/cli.js", "fix"]);
    } finally {
      process.argv[1] = original;
    }
  });
});

describe("buildLaunchAgentPath", () => {
  it("includes node bin dir before dotfiles bin and /usr/bin", () => {
    vi.mocked(existsSync).mockImplementation((p) => {
      const s = String(p);
      if (s.includes("dotfiles/bin")) return true;
      if (s === "/opt/homebrew/bin") return true;
      if (s.endsWith("/.local/bin")) return true;
      return false;
    });
    const pathValue = buildLaunchAgentPath("/mock-home", "/mock-home/.nvm/versions/node/v22.0.0/bin");
    expect(pathValue.startsWith("/mock-home/.nvm/versions/node/v22.0.0/bin:")).toBe(true);
    expect(pathValue).toContain("/mock-home/apps/tooling/dotfiles/bin");
    expect(pathValue).toContain("/usr/bin");
  });
});

describe("resolveDotfilesBinPath", () => {
  it("prefers an existing DOTFILES_DIR over a guessed checkout", () => {
    vi.stubEnv("DOTFILES_DIR", "/mock-home/apps/tooling/dotfiles-applied");
    vi.mocked(existsSync).mockImplementation((path) => {
      const value = String(path);
      return (
        value === "/mock-home/apps/tooling/dotfiles-applied/bin" || value === "/mock-home/apps/tooling/dotfiles/bin"
      );
    });

    expect(resolveDotfilesBinPath("/mock-home")).toBe("/mock-home/apps/tooling/dotfiles-applied/bin");
  });

  it("uses the managed Dotfiles environment when launchd has no DOTFILES_DIR", () => {
    vi.mocked(readFileSync).mockReturnValue('export DOTFILES_DIR="$HOME/apps/tooling/dotfiles-applied"\n');
    vi.mocked(existsSync).mockImplementation((path) => String(path) === "/mock-home/apps/tooling/dotfiles-applied/bin");

    expect(resolveDotfilesBinPath("/mock-home")).toBe("/mock-home/apps/tooling/dotfiles-applied/bin");
  });

  // Regression: agent shells export DOTFILES_DIR as the development checkout.
  // Preferring it made `agentbrew fix` and `dotfiles apply` flip every
  // com.agentbrew.* plist PATH between the two checkouts.
  it("prefers the managed Dotfiles environment over a caller DOTFILES_DIR", () => {
    vi.stubEnv("DOTFILES_DIR", "/mock-home/apps/tooling/dotfiles");
    vi.mocked(readFileSync).mockReturnValue('export DOTFILES_DIR="$HOME/apps/tooling/dotfiles-applied"\n');
    vi.mocked(existsSync).mockReturnValue(true);

    expect(resolveDotfilesBinPath("/mock-home")).toBe("/mock-home/apps/tooling/dotfiles-applied/bin");
  });

  it("falls back to DOTFILES_DIR when env.sh names a missing checkout", () => {
    vi.stubEnv("DOTFILES_DIR", "/mock-home/apps/tooling/dotfiles");
    vi.mocked(readFileSync).mockReturnValue('export DOTFILES_DIR="$HOME/gone"\n');
    vi.mocked(existsSync).mockImplementation((path) => String(path) === "/mock-home/apps/tooling/dotfiles/bin");

    expect(resolveDotfilesBinPath("/mock-home")).toBe("/mock-home/apps/tooling/dotfiles/bin");
  });
});

describe("launchAgentPathHasRequiredPrefixes", () => {
  it("requires node and dotfiles segments at PATH start", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const prefixes = requiredLaunchAgentPathPrefixes("/mock-home");
    const pathValue = `${prefixes.join(":")}:/usr/bin:/bin`;
    expect(launchAgentPathHasRequiredPrefixes(pathValue, "/mock-home")).toBe(true);
    expect(launchAgentPathHasRequiredPrefixes("/usr/bin:/bin", "/mock-home")).toBe(false);
  });

  it("accepts a Dotfiles endpoint-prefix repair before node", () => {
    const dotfilesBin = "/mock-home/apps/tooling/dotfiles-applied/bin";
    vi.stubEnv("DOTFILES_DIR", "/mock-home/apps/tooling/dotfiles-applied");
    vi.mocked(existsSync).mockImplementation((path) => String(path) === dotfilesBin);

    expect(launchAgentPathHasRequiredPrefixes(`${dotfilesBin}:${getNodeBinDir()}:/usr/bin:/bin`, "/mock-home")).toBe(
      true,
    );
  });

  it("accepts PATH produced by buildLaunchAgentPath", () => {
    vi.mocked(existsSync).mockImplementation((p) => {
      const s = String(p);
      if (s.includes("dotfiles/bin")) return true;
      if (s === "/opt/homebrew/bin") return true;
      if (s.endsWith("/.local/bin")) return true;
      return false;
    });
    const nodeBin = getNodeBinDir();
    const pathValue = buildLaunchAgentPath("/mock-home", nodeBin);
    expect(launchAgentPathHasRequiredPrefixes(pathValue, "/mock-home")).toBe(true);
  });
});
