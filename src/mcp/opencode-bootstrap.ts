import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, totalmem } from "node:os";
import chalk from "chalk";
import { logSkipped } from "../core/logger.js";
import { buildLaunchAgentPath, LAUNCHAGENT_LANG } from "../sync/scheduler-paths.js";
import { expandHome } from "../utils.js";
import { readMcpJson, writeMcpJson } from "./mcp.js";

const OPENCODE_CONFIG = "~/.config/opencode/opencode.json";
const OPENCODE_SKILLS_DIR = "~/.config/opencode/skills";
const OPENCODE_COMMANDS_DIR = "~/.config/opencode/commands";
const OLLAMA_URL = "http://localhost:11434/v1";

// ── Hardware detection ──────────────────────────────────────────────────────

/** Detected machine hardware profile. */
interface MachineProfile {
  os: "darwin" | "linux" | "win32" | string;
  arch: "arm64" | "x64" | string;
  chip: string;
  cpuCores: number;
  /** Total unified memory in GB (Apple Silicon shares GPU/CPU RAM). */
  totalMemoryGB: number;
  /** GPU cores (Apple Silicon only; 0 for others). */
  gpuCores: number;
  /** Whether this is Apple Silicon (M1/M2/M3/M4 family). */
  isAppleSilicon: boolean;
  /** Specific Apple chip variant (e.g. "M3 Max", "M2 Pro"). */
  appleChipVariant: string;
}

/** Read a sysctl value (macOS). Returns empty string on failure. */
function sysctl(key: string): string {
  try {
    return execFileSync("sysctl", ["-n", key], { stdio: "pipe", timeout: 3_000 }).toString().trim();
  } catch {
    return "";
  }
}

function detectAppleSiliconGpuCores(appleChipVariant: string): number {
  const gpuStr = sysctl("machdep.cpu.gpu_core_count");
  if (gpuStr) {
    const parsed = Number.parseInt(gpuStr, 10) || 0;
    if (parsed > 0) return parsed;
  }

  // Fallback: read from system_profiler
  try {
    const spOutput = execFileSync("system_profiler", ["SPDisplaysDataType", "-json"], {
      stdio: "pipe",
      timeout: 10_000,
    }).toString();
    const spData = JSON.parse(spOutput) as Record<string, unknown[]>;
    const displays = spData.SPDisplaysDataType as Array<Record<string, unknown>> | undefined;
    const gpuInfo = displays?.[0];
    const cores = gpuInfo?.sppci_cores as string | undefined;
    if (cores) return Number.parseInt(cores, 10) || 0;
  } catch {
    // Estimate from chip variant
  }

  return estimateGpuCores(appleChipVariant);
}

/** Detect the full machine hardware profile. */
export function detectMachine(): MachineProfile {
  const os = platform();
  const cpuArch = arch();
  const cpuCores = cpus().length;
  const totalMemoryGB = Math.round(totalmem() / 1024 ** 3);

  let chip = cpus()[0]?.model ?? "unknown";
  let gpuCores = 0;
  let isAppleSilicon = false;
  let appleChipVariant = "";

  if (os === "darwin" && cpuArch === "arm64") {
    isAppleSilicon = true;
    // Get the exact chip name from macOS
    const chipBrand = sysctl("machdep.cpu.brand_string");
    if (chipBrand) chip = chipBrand;

    // Parse Apple chip variant (M1, M2 Pro, M3 Max, M4 Ultra, etc.)
    const match = /Apple (M\d+(?:\s+(?:Pro|Max|Ultra))?)/.exec(chip);
    appleChipVariant = match?.[1] ?? "";

    gpuCores = detectAppleSiliconGpuCores(appleChipVariant);
  }

  return { os, arch: cpuArch, chip, cpuCores, totalMemoryGB, gpuCores, isAppleSilicon, appleChipVariant };
}

/** Estimate GPU cores from Apple chip variant name when sysctl fails. */
function estimateGpuCores(variant: string): number {
  if (variant.includes("Ultra")) return 76;
  if (variant.includes("Max")) return 40;
  if (variant.includes("Pro")) return 18;
  return 10; // base M-series
}

// ── Model selection ─────────────────────────────────────────────────────────

/**
 * Model recommendation with rationale.
 * Ranked by coding benchmark performance (llm-stats.com/leaderboards/best-ai-for-coding).
 *
 * Quantization strategy for Apple Silicon:
 * - Q4_K_M: best speed/quality tradeoff, fits more model in unified memory
 * - Q8_0: higher quality but 2× the memory; only when headroom is large
 * - FP16: maximum quality, only for small models on large-memory machines
 *
 * The model must fit in ~80% of total RAM to leave room for OS + opencode + MCP servers.
 */
interface ModelRecommendation {
  /** Ollama model tag (e.g. "qwen3:32b-q4_K_M"). */
  model: string;
  /** Human-readable name. */
  name: string;
  /** Approximate memory needed in GB. */
  memoryGB: number;
  /** Why this model was chosen. */
  rationale: string;
}

/** Pick the best coding model that fits this machine's memory. */
export function selectModel(profile: MachineProfile): ModelRecommendation {
  const usableGB = Math.floor(profile.totalMemoryGB * 0.8);

  // Tier 1: 96GB+ (M3 Max 96GB, M2 Ultra, M4 Max 128GB)
  // Can run Qwen3 235B-A22B (MoE — only 22B active, but full weights ~130GB at Q4)
  // or Qwen3 32B at Q8 with massive headroom
  if (usableGB >= 100) {
    return {
      model: "qwen3:235b-a22b",
      name: "Qwen3 235B-A22B",
      memoryGB: 98,
      rationale: "#1 open-source coding model (MoE, 22B active params). Fits in your unified memory.",
    };
  }

  // Tier 2: 64GB+ (M3 Max 64GB, M2 Max, M4 Pro 48GB+)
  // Qwen3 32B at Q8_0 (~34GB) — higher quality quantization
  if (usableGB >= 45) {
    return {
      model: "qwen3:32b-q8_0",
      name: "Qwen3 32B (Q8)",
      memoryGB: 34,
      rationale: "Best coding model at high-quality Q8 quantization. Your memory allows it.",
    };
  }

  // Tier 3: 32GB+ (M3 Pro, M2 Pro, M3 Max 36GB)
  // Qwen3 32B at Q4_K_M (~20GB) — standard quality, fits well
  if (usableGB >= 24) {
    return {
      model: "qwen3:32b",
      name: "Qwen3 32B (Q4)",
      memoryGB: 20,
      rationale: "Best coding model that fits your memory at Q4 quantization.",
    };
  }

  // Tier 4: 16GB+ (M3, M2, M1 Pro 16GB)
  // Qwen3 14B — smaller but still strong on coding benchmarks
  if (usableGB >= 12) {
    return {
      model: "qwen3:14b",
      name: "Qwen3 14B",
      memoryGB: 9,
      rationale: "Strong coding model sized for 16GB machines.",
    };
  }

  // Tier 5: 8GB (M1, M2 base)
  // Qwen3 8B — smallest viable coding model
  return {
    model: "qwen3:8b",
    name: "Qwen3 8B",
    memoryGB: 5,
    rationale: "Smallest viable coding model for 8GB machines.",
  };
}

// ── Ollama tuning for Apple Silicon ─────────────────────────────────────────

/**
 * Compute optimal Ollama environment variables for Apple Silicon.
 *
 * Key tuning knobs:
 * - OLLAMA_NUM_PARALLEL: concurrent request slots (1 for coding = sequential)
 * - OLLAMA_MAX_LOADED_MODELS: keep model hot in memory (1 = no swapping)
 * - OLLAMA_KEEP_ALIVE: how long to keep model loaded after last request
 * - OLLAMA_FLASH_ATTENTION: enable Flash Attention for Metal (faster on M-series)
 * - OLLAMA_GPU_LAYERS: -1 = offload all layers to GPU (Apple Silicon unified memory)
 * - OLLAMA_RUNNERS_DIR: not needed — Ollama auto-detects Metal on macOS arm64
 */
export function computeOllamaEnv(profile: MachineProfile): Record<string, string> {
  const env: Record<string, string> = {};

  // Flash Attention: massive speedup on Apple Silicon Metal backend
  env.OLLAMA_FLASH_ATTENTION = "1";

  // Keep model loaded indefinitely — no cold-start penalty between prompts
  env.OLLAMA_KEEP_ALIVE = "-1";

  // Single model, single request — coding is sequential, not parallel
  env.OLLAMA_MAX_LOADED_MODELS = "1";
  env.OLLAMA_NUM_PARALLEL = "1";

  // Context window: Apple Silicon can handle large contexts
  // M3 Max with 32B Q4 has ~12GB headroom for KV cache → ~32K context
  // Smaller machines get proportionally less
  if (profile.totalMemoryGB >= 64) {
    env.OLLAMA_NUM_CTX = "32768";
  } else if (profile.totalMemoryGB >= 32) {
    env.OLLAMA_NUM_CTX = "16384";
  } else {
    env.OLLAMA_NUM_CTX = "8192";
  }

  return env;
}

/**
 * Write a launchd plist that starts Ollama with optimized env vars and
 * high process priority (nice -10) on login. macOS only.
 *
 * This replaces the default `brew services start ollama` which runs at
 * normal priority with no tuning. The plist:
 * - Sets ProcessType to Interactive (highest macOS QoS tier)
 * - Sets Nice to -10 (elevated scheduling priority)
 * - Injects all OLLAMA_* env vars for Metal/Flash Attention/context tuning
 * - Runs KeepAlive so it restarts on crash
 * - Logs to ~/Library/Logs/ollama.log for debugging
 */
function writeOllamaLaunchdPlist(env: Record<string, string>): string {
  const plistPath = expandHome("~/Library/LaunchAgents/com.agentbrew.ollama.plist");
  const ollamaPath = findOllamaBinary();
  const logPath = expandHome("~/Library/Logs/ollama.log");
  const home = expandHome("~");
  const pathValue = buildLaunchAgentPath(home);

  const envEntries = Object.entries(env)
    .map(([k, v]) => `      <key>${k}</key>\n      <string>${v}</string>`)
    .join("\n");

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.agentbrew.ollama</string>
  <key>ProgramArguments</key>
  <array>
    <string>${ollamaPath}</string>
    <string>serve</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${pathValue}</string>
    <key>LANG</key>
    <string>${LAUNCHAGENT_LANG}</string>
    <key>HOME</key>
    <string>${home}</string>
${envEntries}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>Nice</key>
  <integer>-10</integer>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`;

  mkdirSync(expandHome("~/Library/LaunchAgents"), { recursive: true });
  writeFileSync(plistPath, plist, "utf-8");
  return plistPath;
}

/** Find the ollama binary path. */
function findOllamaBinary(): string {
  try {
    return execFileSync("which", ["ollama"], { stdio: "pipe", timeout: 3_000 }).toString().trim();
  } catch {
    return "/usr/local/bin/ollama";
  }
}

/**
 * Load and start the launchd agent. Unloads any existing one first to
 * pick up config changes.
 */
function loadLaunchdAgent(plistPath: string): boolean {
  try {
    // Unload existing (ignore errors if not loaded)
    try {
      execFileSync("launchctl", ["unload", plistPath], { stdio: "pipe", timeout: 5_000 });
    } catch {
      // Not loaded — fine
    }
    // Stop any existing ollama serve (brew services or manual)
    try {
      execFileSync("brew", ["services", "stop", "ollama"], { stdio: "pipe", timeout: 10_000 });
    } catch {
      // Not running via brew — fine
    }
    try {
      execFileSync("pkill", ["-f", "ollama serve"], { stdio: "pipe", timeout: 3_000 });
    } catch {
      // Not running — fine
    }
    // Brief pause for port release
    execFileSync("sleep", ["1"], { stdio: "pipe" });
    // Load our optimized agent
    execFileSync("launchctl", ["load", plistPath], { stdio: "pipe", timeout: 5_000 });
    return true;
  } catch (e) {
    logSkipped("opencode-bootstrap/loadLaunchdAgent", e);
    return false;
  }
}

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Check if a CLI binary is available on PATH. */
function isInstalled(bin: string): boolean {
  try {
    execFileSync("which", [bin], { stdio: "pipe", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/** Check if Ollama service is running. */
function isOllamaRunning(): boolean {
  try {
    execFileSync("curl", ["-sf", "http://localhost:11434/api/tags"], {
      stdio: "pipe",
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

/** Check if a model is already pulled in Ollama. */
function isModelPulled(model: string): boolean {
  try {
    const output = execFileSync("ollama", ["list"], { stdio: "pipe", timeout: 10_000 }).toString();
    // Match the base model name (before any quantization suffix)
    const baseName = model.split(":")[0];
    const tag = model.split(":")[1] ?? "";
    return output.includes(baseName) && (tag === "" || output.includes(tag));
  } catch {
    return false;
  }
}

/** Install Ollama via Homebrew. */
function installOllama(): boolean {
  if (!isInstalled("brew")) {
    console.log(chalk.red("  ✗ Homebrew not found — install Ollama manually: https://ollama.ai"));
    return false;
  }
  try {
    console.log(chalk.dim("  Installing Ollama via Homebrew..."));
    execFileSync("brew", ["install", "ollama"], { stdio: "inherit", timeout: 120_000 });
    return true;
  } catch (e) {
    logSkipped("opencode-bootstrap/installOllama", e);
    console.log(chalk.red("  ✗ Failed to install Ollama — install manually: https://ollama.ai"));
    return false;
  }
}

/** Start Ollama service (fallback when launchd is not available). */
function startOllamaFallback(): boolean {
  console.log(chalk.dim("  Starting Ollama service..."));
  const child = spawn("ollama", ["serve"], { stdio: "ignore", detached: true });
  child.unref();
  for (let i = 0; i < 10; i++) {
    if (isOllamaRunning()) return true;
    execFileSync("sleep", ["1"], { stdio: "pipe" });
  }
  return isOllamaRunning();
}

/** Pull a model via Ollama. */
function pullModel(model: string): boolean {
  try {
    console.log(chalk.dim(`  Pulling ${model} (this may take a while on first run)...`));
    execFileSync("ollama", ["pull", model], { stdio: "inherit", timeout: 1_200_000 });
    return true;
  } catch (e) {
    logSkipped("opencode-bootstrap/pullModel", e);
    console.log(chalk.red(`  ✗ Failed to pull ${model}`));
    return false;
  }
}

/** Write provider + model config to opencode.json, preserving existing keys. */
function writeOpencodeProviderConfig(model: string): void {
  const configPath = expandHome(OPENCODE_CONFIG);
  mkdirSync(expandHome("~/.config/opencode"), { recursive: true });

  const config = readMcpJson(configPath) as Record<string, unknown>;
  config.provider = { ollama: { url: OLLAMA_URL } };
  config.model = { big: model, small: model };
  writeMcpJson(configPath, config);
}

/** Ensure skills and commands directories exist. */
function ensureDirectories(): void {
  mkdirSync(expandHome(OPENCODE_SKILLS_DIR), { recursive: true });
  mkdirSync(expandHome(OPENCODE_COMMANDS_DIR), { recursive: true });
}

// ── Main bootstrap ──────────────────────────────────────────────────────────

/**
 * Bootstrap OpenCode with the best local model for this machine.
 *
 * Auto-detects hardware (Apple Silicon variant, unified memory, GPU cores),
 * selects the optimal Qwen3 model + quantization, configures Ollama with
 * Metal Flash Attention + high process priority + tuned context window,
 * and writes the OpenCode config.
 *
 * On Apple Silicon Macs:
 * - Installs a launchd agent that runs Ollama at Interactive QoS (nice -10)
 * - Enables OLLAMA_FLASH_ATTENTION for Metal-accelerated inference
 * - Sets OLLAMA_KEEP_ALIVE=-1 so the model stays hot in unified memory
 * - Tunes OLLAMA_NUM_CTX based on available memory headroom
 *
 * The MCP servers in opencode.json are managed by agentbrew's MCP sync —
 * this bootstrap only writes the `provider` and `model` keys.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Bootstrap function is intentionally complex
export async function bootstrapOpencode(options?: { model?: string; dryRun?: boolean }): Promise<void> {
  const dryRun = options?.dryRun ?? false;

  // ── 1. Detect hardware ──────────────────────────────────────────────────
  const profile = detectMachine();
  const recommendation = options?.model
    ? { model: options.model, name: options.model, memoryGB: 0, rationale: "User override." }
    : selectModel(profile);

  console.log(chalk.bold("\n── Machine Profile ─────────────────────────\n"));
  console.log(`  Chip:     ${chalk.cyan(profile.chip)}`);
  if (profile.appleChipVariant) {
    console.log(`  Variant:  ${chalk.cyan(profile.appleChipVariant)}`);
  }
  console.log(
    `  Cores:    ${chalk.cyan(`${profile.cpuCores} CPU`)}${profile.gpuCores ? ` / ${chalk.cyan(`${profile.gpuCores} GPU`)}` : ""}`,
  );
  console.log(`  Memory:   ${chalk.cyan(`${profile.totalMemoryGB}GB`)} unified`);
  console.log(`  Arch:     ${chalk.cyan(`${profile.os}/${profile.arch}`)}`);

  console.log(chalk.bold("\n── Model Selection ─────────────────────────\n"));
  console.log(`  Model:    ${chalk.cyan(recommendation.name)} (${recommendation.model})`);
  if (recommendation.memoryGB > 0) {
    console.log(`  Memory:   ~${recommendation.memoryGB}GB of ${profile.totalMemoryGB}GB`);
  }
  console.log(`  Reason:   ${chalk.dim(recommendation.rationale)}`);

  console.log(chalk.bold("\n── Setup ───────────────────────────────────\n"));

  // ── 2. Install Ollama ───────────────────────────────────────────────────
  if (isInstalled("ollama")) {
    console.log(chalk.green("  ✓ Ollama installed"));
  } else if (dryRun) {
    console.log(chalk.blue("  ~ Would install Ollama via Homebrew"));
  } else {
    if (!installOllama()) return;
    console.log(chalk.green("  ✓ Ollama installed"));
  }

  // ── 3. Configure + start Ollama with optimal settings ───────────────────
  if (profile.isAppleSilicon && profile.os === "darwin") {
    const ollamaEnv = computeOllamaEnv(profile);

    if (dryRun) {
      console.log(chalk.blue("  ~ Would install optimized launchd agent:"));
      for (const [k, v] of Object.entries(ollamaEnv)) {
        console.log(chalk.blue(`      ${k}=${v}`));
      }
      console.log(chalk.blue("      ProcessType=Interactive, Nice=-10"));
    } else {
      const plistPath = writeOllamaLaunchdPlist(ollamaEnv);
      console.log(chalk.green(`  ✓ Launchd agent written: ${chalk.dim(plistPath)}`));

      if (loadLaunchdAgent(plistPath)) {
        // Wait for Ollama to come up via launchd
        let started = false;
        for (let i = 0; i < 15; i++) {
          if (isOllamaRunning()) {
            started = true;
            break;
          }
          execFileSync("sleep", ["1"], { stdio: "pipe" });
        }
        if (started) {
          console.log(chalk.green("  ✓ Ollama running (Interactive QoS, nice -10, Flash Attention)"));
        } else {
          console.log(chalk.yellow("  ⚠ Launchd loaded but Ollama not responding — check ~/Library/Logs/ollama.log"));
        }
      } else {
        console.log(chalk.yellow("  ⚠ Could not load launchd agent — falling back to manual start"));
        if (!isOllamaRunning()) startOllamaFallback();
      }

      // Print tuning summary
      console.log(chalk.dim(`      Flash Attention: ON (Metal)`));
      console.log(chalk.dim(`      Keep Alive: indefinite (model stays hot)`));
      console.log(chalk.dim(`      Context: ${ollamaEnv.OLLAMA_NUM_CTX} tokens`));
      console.log(chalk.dim(`      Priority: Interactive QoS, nice -10`));
    }
  } else {
    // Non-Apple-Silicon: just start Ollama normally
    if (isOllamaRunning()) {
      console.log(chalk.green("  ✓ Ollama service running"));
    } else if (dryRun) {
      console.log(chalk.blue("  ~ Would start Ollama service"));
    } else {
      if (startOllamaFallback()) {
        console.log(chalk.green("  ✓ Ollama service started"));
      } else {
        console.log(chalk.yellow("  ⚠ Could not start Ollama — run `ollama serve` manually"));
      }
    }
  }

  // ── 4. Pull model ──────────────────────────────────────────────────────
  if (isModelPulled(recommendation.model)) {
    console.log(chalk.green(`  ✓ ${recommendation.model} model ready`));
  } else if (dryRun) {
    console.log(chalk.blue(`  ~ Would pull ${recommendation.model} (~${recommendation.memoryGB}GB)`));
  } else {
    if (!pullModel(recommendation.model)) return;
    console.log(chalk.green(`  ✓ ${recommendation.model} model ready`));
  }

  // ── 5. Write OpenCode config ───────────────────────────────────────────
  if (dryRun) {
    console.log(chalk.blue(`  ~ Would write provider + model config to ${OPENCODE_CONFIG}`));
  } else {
    writeOpencodeProviderConfig(recommendation.model);
    console.log(chalk.green(`  ✓ OpenCode config written (${OPENCODE_CONFIG})`));
  }

  // ── 6. Create directories ──────────────────────────────────────────────
  if (dryRun) {
    console.log(chalk.blue("  ~ Would create skills/ and commands/ directories"));
  } else {
    ensureDirectories();
    console.log(chalk.green("  ✓ Skills and commands directories ready"));
  }

  // ── 7. Install opencode CLI ────────────────────────────────────────────
  if (isInstalled("opencode")) {
    console.log(chalk.green("  ✓ opencode CLI installed"));
  } else if (dryRun) {
    console.log(chalk.blue("  ~ Would install opencode via npm"));
  } else {
    try {
      console.log(chalk.dim("  Installing opencode CLI..."));
      execFileSync("npm", ["install", "-g", "opencode@latest"], { stdio: "inherit", timeout: 60_000 });
      console.log(chalk.green("  ✓ opencode CLI installed"));
    } catch (e) {
      logSkipped("opencode-bootstrap/installOpencode", e);
      console.log(chalk.yellow("  ⚠ Could not install opencode — run `npm install -g opencode@latest` manually"));
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log(chalk.bold("\n── Summary ─────────────────────────────────\n"));
  console.log(`  Machine:  ${chalk.cyan(profile.appleChipVariant || profile.chip)} / ${profile.totalMemoryGB}GB`);
  console.log(`  Model:    ${chalk.cyan(recommendation.name)} (${recommendation.model})`);
  console.log(`  Provider: ${chalk.cyan("Ollama")} (local, free, no API key)`);
  if (profile.isAppleSilicon) {
    console.log(`  Backend:  ${chalk.cyan("Metal")} (Flash Attention, GPU-offloaded, nice -10)`);
  }
  console.log(`  Config:   ${chalk.cyan(OPENCODE_CONFIG)}`);
  console.log(`  MCP:      ${chalk.dim("managed by agentbrew sync")}`);
  console.log();
  if (!dryRun) {
    console.log(chalk.bold("  Run `agentbrew sync` to deploy MCP servers, then `opencode` to start.\n"));
  }
}
