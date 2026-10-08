import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import chalk from "chalk";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { FISH_HOOK_PATH, SHELL_HOOK_PATH } from "./paths.js";
import { ICON_SUCCESS } from "./ui/output.js";
import { expandHome } from "./utils.js";

const HOOK_PATH = SHELL_HOOK_PATH;
const GUARD = "# agentbrew shell hook";

type ShellType = "zsh" | "bash" | "fish";

/** Detect the user's login shell from $SHELL. Defaults to zsh. */
export function detectShell(): ShellType {
  const shell = process.env.SHELL ?? "";
  if (shell.endsWith("/fish") || shell.endsWith("/fish3")) return "fish";
  if (shell.endsWith("/bash")) return "bash";
  return "zsh";
}

/** RC files to source the hook from, keyed by shell type. */
const RC_FILES: Record<ShellType, string[]> = {
  zsh: ["~/.zshrc"],
  bash: ["~/.bashrc", "~/.bash_profile"],
  fish: ["~/.config/fish/config.fish"],
};

/** The shell hook script for bash/zsh — pure shell, no Node.js, < 5ms. */
function generateHookScript(): string {
  return `${GUARD}
# Auto-detect agent assets on cd. < 5ms — pure shell, no Node.js startup.
# Install: agentbrew hook install --shell
# Remove:  agentbrew hook uninstall --shell
_agentbrew_detect() {
  [[ "$_agentbrew_last_dir" == "$PWD" ]] && return
  _agentbrew_last_dir="$PWD"
  local found=()
  [[ -f Agentfile || -f Agentfile.yaml || -f Agentfile.yml ]] && found+=(Agentfile)
  [[ -d .claude/skills || -d .cursor/skills ]] && found+=(skills)
  [[ -d .cursor/rules ]] && found+=(rules)
  [[ -f .cursor/mcp.json || -f .mcp.json ]] && found+=(MCP)
  [[ -f AGENTS.md ]] && found+=(AGENTS.md)
  (( \${#found[@]} )) || return
  printf '\\033[2m  ⚡ agentbrew: %s detected. Run \\\`agentbrew\\\` for details.\\033[0m\\n' "\${found[*]}"
}

# Hook into the appropriate shell
if [[ -n "$ZSH_VERSION" ]]; then
  autoload -Uz add-zsh-hook 2>/dev/null
  add-zsh-hook chpwd _agentbrew_detect 2>/dev/null
elif [[ -n "$BASH_VERSION" ]]; then
  _agentbrew_prompt_command() { _agentbrew_detect; }
  if [[ "$PROMPT_COMMAND" != *_agentbrew_prompt_command* ]]; then
    PROMPT_COMMAND="_agentbrew_prompt_command\${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
  fi
fi
`;
}

/** The shell hook script for fish — native fish syntax. */
function generateFishHookScript(): string {
  const fishHookPath = expandHome(FISH_HOOK_PATH);
  return `${GUARD}
# Auto-detect agent assets on cd. < 5ms — pure fish, no Node.js startup.
# Install: agentbrew hook install --shell
# Remove:  agentbrew hook uninstall --shell
function _agentbrew_detect --on-variable PWD
  test "$_agentbrew_last_dir" = "$PWD"; and return
  set -g _agentbrew_last_dir "$PWD"
  set -l found
  test -f Agentfile; or test -f Agentfile.yaml; or test -f Agentfile.yml; and set -a found Agentfile
  test -d .claude/skills; or test -d .cursor/skills; and set -a found skills
  test -d .cursor/rules; and set -a found rules
  test -f .cursor/mcp.json; or test -f .mcp.json; and set -a found MCP
  test -f AGENTS.md; and set -a found AGENTS.md
  test (count $found) -eq 0; and return
  printf '\\033[2m  ⚡ agentbrew: %s detected. Run \`agentbrew\` for details.\\033[0m\\n' (string join " " $found)
end
# Source: ${fishHookPath}
`;
}

/** Add a source line to an rc file if the guard is absent. Returns true if modified. */
function addToRcFile(rcPath: string, sourceLine: string): boolean {
  if (!existsSync(rcPath)) return false;
  const content = readFileSync(rcPath, "utf-8");
  if (content.includes(GUARD)) return false;
  appendFileSync(rcPath, `\n${GUARD}\n${sourceLine}\n`);
  return true;
}

/** Remove agentbrew guard and source lines from an rc file. Returns true if modified. */
function removeFromRcFile(rcPath: string): boolean {
  if (!existsSync(rcPath)) return false;
  const content = readFileSync(rcPath, "utf-8");
  if (!content.includes(GUARD)) return false;
  const cleaned = content
    .split("\n")
    .filter((line) => !line.includes(GUARD) && !line.includes("shell-hook.sh") && !line.includes("shell-hook.fish"))
    .join("\n");
  writeFileAtomicSync(rcPath, cleaned, "utf-8");
  return true;
}

/** Install the shell hook — writes the script file and sources it from the appropriate rc file. */
export function installShellHook(): void {
  const shell = detectShell();
  const hookPath = expandHome(HOOK_PATH);
  const hookDir = dirname(hookPath);
  mkdirSync(hookDir, { recursive: true });

  // Write the bash/zsh hook script (always — it's polyglot)
  writeFileAtomicSync(hookPath, generateHookScript(), "utf-8");
  console.log(`  ${ICON_SUCCESS} Shell hook written to ${HOOK_PATH}`);

  if (shell === "fish") {
    // Also write the fish-specific hook
    const fishPath = expandHome(FISH_HOOK_PATH);
    writeFileAtomicSync(fishPath, generateFishHookScript(), "utf-8");
    console.log(`  ${ICON_SUCCESS} Fish hook written to ${FISH_HOOK_PATH}`);
  }

  // Source from the appropriate rc file(s)
  const rcFiles = RC_FILES[shell];
  const sourceLine = shell === "fish" ? `source "${expandHome(FISH_HOOK_PATH)}"` : `source "${hookPath}"`;
  let sourced = false;

  for (const rc of rcFiles) {
    const rcPath = expandHome(rc);
    if (addToRcFile(rcPath, sourceLine)) {
      console.log(chalk.green(`  ✓ Added to ${rc}`));
      sourced = true;
      break;
    }
    if (existsSync(rcPath)) {
      console.log(chalk.dim(`  Already in ${rc}`));
      sourced = true;
      break;
    }
  }

  if (!sourced) {
    console.log(chalk.dim(`  Add to your shell config: ${sourceLine}`));
  }

  const restartHint =
    shell === "fish" ? "source ~/.config/fish/config.fish" : `source ~/${shell === "bash" ? ".bashrc" : ".zshrc"}`;
  console.log(chalk.dim(`  Restart your shell or run: ${restartHint}\n`));
}

/** Remove the shell hook — deletes script files and removes source lines from all rc files. */
export function uninstallShellHook(): void {
  const hookPath = expandHome(HOOK_PATH);
  if (existsSync(hookPath)) {
    unlinkSync(hookPath);
    console.log(`  ${ICON_SUCCESS} Removed ${HOOK_PATH}`);
  }

  const fishPath = expandHome(FISH_HOOK_PATH);
  if (existsSync(fishPath)) {
    unlinkSync(fishPath);
    console.log(`  ${ICON_SUCCESS} Removed ${FISH_HOOK_PATH}`);
  }

  // Clean all known rc files (not just the current shell — full cleanup)
  const allRcFiles = [...RC_FILES.zsh, ...RC_FILES.bash, ...RC_FILES.fish];
  for (const rc of allRcFiles) {
    const rcPath = expandHome(rc);
    if (removeFromRcFile(rcPath)) {
      console.log(chalk.green(`  ✓ Removed from ${rc}`));
    }
  }

  console.log(chalk.dim("  Restart your shell to deactivate.\n"));
}

/** Check if the shell hook is installed. */
export function isShellHookInstalled(): boolean {
  return existsSync(expandHome(HOOK_PATH));
}
