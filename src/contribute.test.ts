import { describe, expect, it } from "vitest";
import { contribute, githubSlug, type Runner, type RunResult } from "./contribute.js";

interface FakeRepo {
  login: string;
  remotes: Record<string, string>;
  branch?: string;
  parent?: string;
  defaultBranch?: string;
  pushAccess?: boolean;
}

function fakeRunner(repo: FakeRepo): { run: Runner; calls: string[] } {
  const calls: string[] = [];
  const ok = (stdout = ""): RunResult => ({ status: 0, stdout, stderr: "" });
  const run: Runner = (cmd, args) => {
    const line = `${cmd} ${args.join(" ")}`;
    calls.push(line);
    if (line === "git rev-parse --show-toplevel") return ok("/work/repo");
    if (line === "git branch --show-current") return ok(repo.branch ?? "fix/typo");
    if (line === "gh api user --jq .login") return ok(repo.login);
    if (line.startsWith("gh api repos/") && line.endsWith("--jq .permissions.push")) {
      return ok(String(repo.pushAccess ?? repo.login === "fyodoriv"));
    }
    if (line === "git remote -v") {
      return ok(
        Object.entries(repo.remotes)
          .flatMap(([name, url]) => [`${name}\t${url} (fetch)`, `${name}\t${url} (push)`])
          .join("\n"),
      );
    }
    if (line.startsWith("gh repo view") && line.includes("parent")) return ok(repo.parent ?? "/");
    if (line.startsWith("gh repo view") && line.includes("defaultBranchRef")) return ok(repo.defaultBranch ?? "main");
    if (line.startsWith("gh pr create")) return ok("https://github.com/fyodoriv/agentbrew/pull/999");
    return ok();
  };
  return { run, calls };
}

const quiet = () => {};

describe("agentbrew contribute", () => {
  it("parses ssh and https GitHub remotes", () => {
    expect(githubSlug("git@github.com:fyodoriv/dotfiles.git")).toBe("fyodoriv/dotfiles");
    expect(githubSlug("https://github.com/fyodoriv/agentbrew")).toBe("fyodoriv/agentbrew");
    expect(githubSlug("https://gitlab.com/a/b.git")).toBeUndefined();
  });

  it("forks, adds the fork remote, pushes to it, and opens the PR upstream for a new contributor", () => {
    const { run, calls } = fakeRunner({
      login: "alex",
      remotes: { origin: "https://github.com/fyodoriv/agentbrew.git" },
    });
    const result = contribute({ run, log: quiet });
    expect(result).toMatchObject({ ok: true, mode: "fork", upstream: "fyodoriv/agentbrew", head: "alex:fix/typo" });
    expect(result.prUrl).toBe("https://github.com/fyodoriv/agentbrew/pull/999");
    expect(calls).toContain("gh repo fork fyodoriv/agentbrew --clone=false");
    expect(calls).toContain("git remote add fork https://github.com/alex/agentbrew.git");
    expect(calls).toContain("git push -u fork HEAD:fix/typo");
    expect(calls).toContain("gh pr create --repo fyodoriv/agentbrew --base main --head alex:fix/typo --fill");
  });

  it("uses upstream directly when a collaborator has push access", () => {
    const { run, calls } = fakeRunner({
      login: "alex",
      remotes: { origin: "https://github.com/team/project.git" },
      pushAccess: true,
    });
    expect(contribute({ run, log: quiet })).toMatchObject({ ok: true, mode: "direct", head: "fix/typo" });
    expect(calls).toContain("git push -u origin HEAD:fix/typo");
    expect(calls.some((c) => c.startsWith("gh repo fork"))).toBe(false);
  });

  it("pushes to the upstream remote rather than a fork when permission is granted", () => {
    const { run, calls } = fakeRunner({
      login: "alex",
      remotes: { origin: "https://github.com/alex/project.git", upstream: "https://github.com/team/project.git" },
      pushAccess: true,
    });
    expect(contribute({ run, log: quiet })).toMatchObject({ ok: true, mode: "direct" });
    expect(calls).toContain("git push -u upstream HEAD:fix/typo");
    expect(calls).not.toContain("git push -u origin HEAD:fix/typo");
  });

  it("forks with flags supported by gh when push access is absent", () => {
    const { run } = fakeRunner({ login: "alex", remotes: { origin: "https://github.com/team/project.git" } });
    const rejectingGh: Runner = (cmd, args, cwd) => {
      if (cmd === "gh" && args[0] === "repo" && args[1] === "fork" && args.includes("--remote=false")) {
        return { status: 1, stdout: "", stderr: "--remote is unsupported with a repository argument" };
      }
      return run(cmd, args, cwd);
    };
    expect(contribute({ run: rejectingGh, log: quiet })).toMatchObject({ ok: true, mode: "fork" });
  });

  it("uses the fork parent as upstream when origin is already the contributor's fork", () => {
    const { run, calls } = fakeRunner({
      login: "alex",
      remotes: { origin: "git@github.com:alex/dotfiles.git" },
      parent: "fyodoriv/dotfiles",
      defaultBranch: "feat/chezmoi",
    });
    const result = contribute({ run, log: quiet, title: "fix: x", bodyFile: "body.md" });
    expect(result).toMatchObject({ ok: true, mode: "fork", upstream: "fyodoriv/dotfiles" });
    expect(calls).toContain("git push -u origin HEAD:fix/typo");
    expect(calls).toContain("git remote add upstream https://github.com/fyodoriv/dotfiles.git");
    expect(calls).toContain(
      "gh pr create --repo fyodoriv/dotfiles --base feat/chezmoi --head alex:fix/typo --title fix: x --body-file body.md",
    );
  });

  it("opens a same-repo PR when the signed-in account owns upstream", () => {
    const { run, calls } = fakeRunner({
      login: "fyodoriv",
      remotes: { origin: "git@github.com:fyodoriv/agentbrew.git" },
    });
    const result = contribute({ run, log: quiet });
    expect(result).toMatchObject({ ok: true, mode: "direct", head: "fix/typo" });
    expect(calls.some((c) => c.startsWith("gh repo fork"))).toBe(false);
    expect(calls).toContain("git push -u origin HEAD:fix/typo");
  });

  it("dry run prints every step and runs none that change anything", () => {
    const { run, calls } = fakeRunner({
      login: "alex",
      remotes: { origin: "https://github.com/fyodoriv/agentbrew.git" },
    });
    const lines: string[] = [];
    const result = contribute({ run, dryRun: true, log: (line) => lines.push(line) });
    expect(result.ok).toBe(true);
    expect(lines.filter((l) => l.startsWith("would run:"))).toHaveLength(4);
    expect(
      calls.some((c) => c.startsWith("gh repo fork") || c.startsWith("git push") || c.startsWith("gh pr create")),
    ).toBe(false);
  });

  it("refuses to open a PR from the default branch or without gh sign-in", () => {
    const onMain = fakeRunner({
      login: "alex",
      remotes: { origin: "https://github.com/fyodoriv/agentbrew.git" },
      branch: "main",
    });
    expect(contribute({ run: onMain.run, log: quiet }).error).toContain("git switch -c");
    const signedOut = fakeRunner({ login: "", remotes: { origin: "https://github.com/fyodoriv/agentbrew.git" } });
    expect(contribute({ run: signedOut.run, log: quiet }).error).toContain("gh auth login");
  });
});
