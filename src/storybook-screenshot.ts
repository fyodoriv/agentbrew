import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface Viewport {
  width: number;
  height: number;
}

interface CliOptions {
  all: boolean;
  baseUrl?: string;
  headless: boolean;
  help: boolean;
  list: boolean;
  outDir: string;
  output?: string;
  stepsFile?: string;
  storyId?: string;
  timeoutMs: number;
  url?: string;
  viewport: Viewport;
}

interface CliParseResult {
  ok: boolean;
  options?: CliOptions;
  error?: string;
}

interface ArgApplyResult {
  error?: string;
  nextIndex: number;
}

export interface StorybookStory {
  id: string;
  name: string;
  title: string;
}

export interface ScreenshotTarget {
  id: string;
  label: string;
  outputPath: string;
  url: string;
}

interface BrowserPage {
  click(selector: string, options?: { timeout?: number }): Promise<unknown>;
  close(): Promise<unknown>;
  goto(
    url: string,
    options?: { timeout?: number; waitUntil?: "load" | "domcontentloaded" | "networkidle" },
  ): Promise<unknown>;
  hover(selector: string, options?: { timeout?: number }): Promise<unknown>;
  keyboard: {
    press(key: string): Promise<unknown>;
  };
  screenshot(options: { fullPage: boolean; path: string }): Promise<unknown>;
  setInputFiles(selector: string, files: string | string[]): Promise<unknown>;
  type(selector: string, text: string, options?: { timeout?: number }): Promise<unknown>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<unknown>;
}

interface BrowserContext {
  close(): Promise<unknown>;
  newPage(): Promise<BrowserPage>;
}

interface Browser {
  close(): Promise<unknown>;
  newContext(options: { viewport: Viewport }): Promise<BrowserContext>;
}

interface PlaywrightRuntime {
  chromium: {
    launch(options: { headless: boolean }): Promise<Browser>;
  };
}

type Step =
  | { action: "click"; selector: string }
  | { action: "hover"; selector: string }
  | { action: "keyboard"; key: string }
  | { action: "type"; selector: string; text: string }
  | { action: "upload"; path: string | string[]; selector: string }
  | { action: "wait"; ms: number }
  | { action: "waitForSelector"; selector: string };

const DEFAULT_OUT_DIR = ".tmp/screenshots";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_VIEWPORT: Viewport = { width: 1440, height: 900 };
const STORYBOOK_PORTS = [6006, 6007, 6008, 6009];

const BOOLEAN_OPTION_HANDLERS: Record<string, (options: CliOptions) => void> = {
  "--all": (options) => {
    options.all = true;
  },
  "--headed": (options) => {
    options.headless = false;
  },
  "--help": (options) => {
    options.help = true;
  },
  "--list": (options) => {
    options.list = true;
  },
  "-h": (options) => {
    options.help = true;
  },
};

const VALUE_OPTION_HANDLERS: Record<string, (options: CliOptions, value: string) => string | undefined> = {
  "--base-url": (options, value) => {
    options.baseUrl = value;
    return undefined;
  },
  "--out-dir": (options, value) => {
    options.outDir = value;
    return undefined;
  },
  "--output": (options, value) => {
    options.output = value;
    return undefined;
  },
  "--port": (options, value) => {
    options.baseUrl = `http://localhost:${value}`;
    return undefined;
  },
  "--steps": (options, value) => {
    options.stepsFile = value;
    return undefined;
  },
  "--story": (options, value) => {
    options.storyId = value;
    return undefined;
  },
  "--timeout": setTimeoutOption,
  "--url": (options, value) => {
    options.url = value;
    return undefined;
  },
  "--viewport": setViewportOption,
};

type StepReader = (value: Record<string, unknown>) => Step | undefined;

const STEP_READERS: Record<string, StepReader> = {
  click: (value) => readSelectorStep("click", value),
  hover: (value) => readSelectorStep("hover", value),
  keyboard: readKeyboardStep,
  type: readTypeStep,
  upload: readUploadStep,
  wait: readWaitStep,
  waitForSelector: (value) => readSelectorStep("waitForSelector", value),
};

export function parseViewport(value: string): Viewport | undefined {
  const match = /^(\d{2,5})x(\d{2,5})$/.exec(value.trim());
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return undefined;
  return { width, height };
}

export function sanitizeFilename(value: string): string {
  const safe = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe || "screenshot";
}

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/g, "");
}

export function storyIframeUrl(baseUrl: string, storyId: string): string {
  return `${normalizeBaseUrl(baseUrl)}/iframe.html?id=${encodeURIComponent(storyId)}`;
}

export function parseCliArgs(argv: string[]): CliParseResult {
  const options = defaultCliOptions();

  for (let index = 0; index < argv.length; index++) {
    const result = applyCliArg(argv, index, options);
    if (result.error) return { ok: false, error: result.error };
    index = result.nextIndex;
  }

  return validateOptions(options);
}

function defaultCliOptions(): CliOptions {
  return {
    all: false,
    headless: true,
    help: false,
    list: false,
    outDir: DEFAULT_OUT_DIR,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    viewport: DEFAULT_VIEWPORT,
  };
}

function applyCliArg(argv: string[], index: number, options: CliOptions): ArgApplyResult {
  const arg = argv[index];
  const booleanHandler = BOOLEAN_OPTION_HANDLERS[arg];
  if (booleanHandler) {
    booleanHandler(options);
    return { nextIndex: index };
  }

  const valueHandler = VALUE_OPTION_HANDLERS[arg];
  if (valueHandler) return applyValueCliArg(argv, index, options, valueHandler);
  if (arg.startsWith("-")) return { error: `unknown option: ${arg}`, nextIndex: index };
  applyPositionalCliArg(options, arg);
  return { nextIndex: index };
}

function applyValueCliArg(
  argv: string[],
  index: number,
  options: CliOptions,
  handler: (options: CliOptions, value: string) => string | undefined,
): ArgApplyResult {
  const value = argv[index + 1];
  const arg = argv[index];
  if (!value || value.startsWith("-")) return { error: `${arg} requires a value`, nextIndex: index };
  const error = handler(options, value);
  return { error, nextIndex: index + 1 };
}

function applyPositionalCliArg(options: CliOptions, arg: string): void {
  if (arg.startsWith("http://") || arg.startsWith("https://")) {
    options.url = arg;
    return;
  }
  options.storyId = arg;
}

function setTimeoutOption(options: CliOptions, value: string): string | undefined {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return "--timeout must be a positive integer";
  options.timeoutMs = parsed;
  return undefined;
}

function setViewportOption(options: CliOptions, value: string): string | undefined {
  const viewport = parseViewport(value);
  if (!viewport) return "--viewport must look like 1440x900";
  options.viewport = viewport;
  return undefined;
}

function validateOptions(options: CliOptions): CliParseResult {
  try {
    const targetModes = [options.all, options.list, options.storyId !== undefined, options.url !== undefined].filter(
      Boolean,
    );
    if (!options.help && targetModes.length === 0) {
      return { ok: false, error: "provide --list, --all, --story <id>, a story id, or --url <url>" };
    }
    if (options.all && options.output) return { ok: false, error: "--output can only be used for one target" };
    return { ok: true, options };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : "invalid arguments" };
  }
}

export function parseStoryIndexPayload(payload: unknown): StorybookStory[] {
  if (!isRecord(payload)) return [];
  const collection = readRecordField(payload, "entries") ?? readRecordField(payload, "stories") ?? payload;
  return Object.values(collection)
    .map(readStory)
    .filter((story): story is StorybookStory => story !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function readStory(value: unknown): StorybookStory | undefined {
  if (!isRecord(value)) return undefined;
  const type = readStringField(value, "type");
  if (type && type !== "story") return undefined;
  const id = readStringField(value, "id");
  if (!id) return undefined;
  const title = readStringField(value, "title") ?? readStringField(value, "kind") ?? id;
  const name = readStringField(value, "name") ?? readStringField(value, "story") ?? id;
  return { id, name, title };
}

export function planScreenshotTargets(
  options: CliOptions,
  baseUrl: string,
  stories: StorybookStory[],
): ScreenshotTarget[] {
  if (options.url) {
    return [
      {
        id: "page",
        label: options.url,
        outputPath: options.output ?? join(options.outDir, "page.png"),
        url: options.url,
      },
    ];
  }

  if (options.all) {
    return stories.map((story) => storyTarget(options, baseUrl, story));
  }

  if (options.storyId) {
    const story = stories.find((entry) => entry.id === options.storyId);
    return [
      storyTarget(options, baseUrl, {
        id: options.storyId,
        name: story?.name ?? options.storyId,
        title: story?.title ?? options.storyId,
      }),
    ];
  }

  return [];
}

function storyTarget(options: CliOptions, baseUrl: string, story: StorybookStory): ScreenshotTarget {
  return {
    id: story.id,
    label: `${story.title} / ${story.name}`,
    outputPath: options.output ?? join(options.outDir, `${sanitizeFilename(story.id)}.png`),
    url: storyIframeUrl(baseUrl, story.id),
  };
}

export function parseStepsPayload(payload: unknown): Step[] {
  const rawSteps = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.steps)
      ? payload.steps
      : [];
  return rawSteps.map(readStep).filter((step): step is Step => step !== undefined);
}

function readStep(value: unknown): Step | undefined {
  if (!isRecord(value)) return undefined;
  const action = readStringField(value, "action");
  return action ? STEP_READERS[action]?.(value) : undefined;
}

function readSelectorStep(
  action: "click" | "hover" | "waitForSelector",
  value: Record<string, unknown>,
): Step | undefined {
  const selector = readStringField(value, "selector");
  return selector ? { action, selector } : undefined;
}

function readKeyboardStep(value: Record<string, unknown>): Step | undefined {
  const key = readStringField(value, "key");
  return key ? { action: "keyboard", key } : undefined;
}

function readTypeStep(value: Record<string, unknown>): Step | undefined {
  const selector = readStringField(value, "selector");
  return selector ? { action: "type", selector, text: readStringField(value, "text") ?? "" } : undefined;
}

function readUploadStep(value: Record<string, unknown>): Step | undefined {
  const selector = readStringField(value, "selector");
  const path = value.path;
  if (!selector || (!isStringArray(path) && typeof path !== "string")) return undefined;
  return { action: "upload", selector, path };
}

function readWaitStep(value: Record<string, unknown>): Step | undefined {
  const ms = readNumberField(value, "ms");
  return ms !== undefined && ms >= 0 ? { action: "wait", ms } : undefined;
}

export async function fetchStoryIndex(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<StorybookStory[]> {
  const errors: string[] = [];
  for (const path of ["index.json", "stories.json"]) {
    const url = `${normalizeBaseUrl(baseUrl)}/${path}`;
    try {
      const response = await fetchImpl(url);
      if (!response.ok) {
        errors.push(`${url}: HTTP ${response.status}`);
        continue;
      }
      const stories = parseStoryIndexPayload(await response.json());
      if (stories.length > 0) return stories;
      errors.push(`${url}: no stories found`);
    } catch (cause) {
      errors.push(`${url}: ${cause instanceof Error ? cause.message : "request failed"}`);
    }
  }
  throw new Error(`could not load Storybook index (${errors.join("; ")})`);
}

export async function detectStorybookBaseUrl(options: CliOptions, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (options.baseUrl) return normalizeBaseUrl(options.baseUrl);
  if (process.env.STORYBOOK_URL) return normalizeBaseUrl(process.env.STORYBOOK_URL);
  for (const port of STORYBOOK_PORTS) {
    const baseUrl = `http://localhost:${port}`;
    try {
      await fetchStoryIndex(baseUrl, fetchImpl);
      return baseUrl;
    } catch {}
  }
  throw new Error(`no Storybook server found on ports ${STORYBOOK_PORTS.join(", ")}; pass --base-url`);
}

function loadSteps(filePath: string | undefined): Step[] {
  if (!filePath) return [];
  const payload: unknown = JSON.parse(readFileSync(resolve(filePath), "utf-8"));
  return parseStepsPayload(payload);
}

function loadPlaywright(): PlaywrightRuntime {
  const require = createRequire(import.meta.url);
  const moduleName = ["play", "wright"].join("");
  const module: unknown = require(moduleName);
  if (isPlaywrightRuntime(module)) return module;
  throw new Error("playwright module did not expose chromium.launch()");
}

function isPlaywrightRuntime(value: unknown): value is PlaywrightRuntime {
  if (!isRecord(value)) return false;
  const chromium = value.chromium;
  return isRecord(chromium) && typeof chromium.launch === "function";
}

export const PLAYWRIGHT_BROWSER_RECOVERY_HINT =
  "Install the Chromium browser with `npm run playwright:install` or `npx playwright install chromium`.";

/** Wrap Playwright browser-launch failures with an actionable recovery hint when the browser cache is missing. */
export function formatBrowserLaunchError(cause: unknown): Error {
  const original = cause instanceof Error ? cause.message : String(cause);
  const looksLikeMissingBrowser =
    /executable doesn't exist|browserType\.launch|playwright install|failed to launch/i.test(original);
  if (looksLikeMissingBrowser) {
    return new Error(`${PLAYWRIGHT_BROWSER_RECOVERY_HINT} Original error: ${original}`);
  }
  return cause instanceof Error ? cause : new Error(original);
}

async function captureTargets(targets: ScreenshotTarget[], steps: Step[], options: CliOptions): Promise<void> {
  let runtime: PlaywrightRuntime;
  try {
    runtime = loadPlaywright();
  } catch (cause) {
    throw new Error(
      `Playwright is required. Install it in this repo with \`npm install -D playwright\`, then run \`npm run playwright:install\` or \`npx playwright install chromium\`. ${cause instanceof Error ? cause.message : ""}`.trim(),
    );
  }

  let browser: Browser;
  try {
    browser = await runtime.chromium.launch({ headless: options.headless });
  } catch (cause) {
    throw formatBrowserLaunchError(cause);
  }
  const context = await browser.newContext({ viewport: options.viewport });
  try {
    for (const target of targets) {
      const page = await context.newPage();
      try {
        await page.goto(target.url, { timeout: options.timeoutMs, waitUntil: "networkidle" });
        for (const step of steps) await runStep(page, step, options.timeoutMs);
        mkdirSync(dirname(target.outputPath), { recursive: true });
        await page.screenshot({ fullPage: true, path: target.outputPath });
        console.log(`✓ ${target.label} → ${target.outputPath}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

async function runStep(page: BrowserPage, step: Step, timeoutMs: number): Promise<void> {
  if (step.action === "click") await page.click(step.selector, { timeout: timeoutMs });
  else if (step.action === "hover") await page.hover(step.selector, { timeout: timeoutMs });
  else if (step.action === "keyboard") await page.keyboard.press(step.key);
  else if (step.action === "type") await page.type(step.selector, step.text, { timeout: timeoutMs });
  else if (step.action === "upload") await page.setInputFiles(step.selector, step.path);
  else if (step.action === "wait") await page.waitForTimeout(step.ms);
  else await page.waitForSelector(step.selector, { timeout: timeoutMs });
}

export function helpText(): string {
  return `Usage: storybook-screenshot [options] [story-id]

Capture Storybook stories with Playwright.

Options:
  --list                 List story ids from the running Storybook
  --all                  Capture every story from index.json/stories.json
  --story <id>           Capture one Storybook story id
  --url <url>            Capture an arbitrary URL
  --base-url <url>       Storybook base URL (default: STORYBOOK_URL or localhost:6006-6009)
  --port <port>          Shortcut for --base-url http://localhost:<port>
  --out-dir <path>       Screenshot directory (default: ${DEFAULT_OUT_DIR})
  --output <path>        Output file for a single target
  --steps <path>         JSON step script with click/type/upload/wait/hover/keyboard actions
  --viewport <WxH>       Browser viewport (default: ${DEFAULT_VIEWPORT.width}x${DEFAULT_VIEWPORT.height})
  --timeout <ms>         Navigation and selector timeout (default: ${DEFAULT_TIMEOUT_MS})
  --headed               Run Chromium headed
  -h, --help             Show this help

Examples:
  storybook-screenshot --list
  storybook-screenshot --all --out-dir .tmp/screenshots
  storybook-screenshot button--primary --output .tmp/screenshots/button.png
  storybook-screenshot --url http://localhost:6006/iframe.html?id=button--primary
`;
}

async function main(argv: string[]): Promise<number> {
  const parsed = parseCliArgs(argv);
  if (!parsed.ok || !parsed.options) {
    console.error(parsed.error ?? "invalid arguments");
    console.error("Run `storybook-screenshot --help` for usage.");
    return 1;
  }
  const options = parsed.options;
  if (options.help) {
    console.log(helpText());
    return 0;
  }

  try {
    await run(options);
    return 0;
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : "storybook-screenshot failed");
    return 1;
  }
}

async function run(options: CliOptions): Promise<void> {
  const baseUrl = options.url ? "" : await detectStorybookBaseUrl(options);
  const stories = options.url ? [] : await fetchStoryIndex(baseUrl);
  if (options.list) {
    printStoryList(stories);
    return;
  }
  const targets = planScreenshotTargets(options, baseUrl, stories);
  if (targets.length === 0) throw new Error("no screenshot targets planned");
  await captureTargets(targets, loadSteps(options.stepsFile), options);
}

function printStoryList(stories: StorybookStory[]): void {
  for (const story of stories) console.log(`${story.id}\t${story.title} / ${story.name}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function readRecordField(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const field = value[key];
  return isRecord(field) ? field : undefined;
}

function readStringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

function readNumberField(value: Record<string, unknown>, key: string): number | undefined {
  const field = value[key];
  return typeof field === "number" ? field : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
