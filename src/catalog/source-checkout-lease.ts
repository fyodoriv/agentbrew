import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  type Stats,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { redactUrlCredentials } from "../core/redact-url.js";

export class SourceCheckoutLeaseRefusal extends Error {}

export interface SourceCheckoutTarget {
  path: string;
  source?: string;
}
interface PreparedTarget {
  actual: string;
  key: string;
  label: string;
  lockPath: string;
}
interface HeldCheckout extends PreparedTarget {
  token: string;
  inode: number;
  active: boolean;
  poisoned: boolean;
}
interface CheckoutScope {
  active: boolean;
  allowedPaths: Set<string>;
  held: Map<string, HeldCheckout>;
}

const LEASE_WAIT_MS = 5_000;
const LEASE_POLL_MS = 20;
const LEASE_ROOT = join(homedir(), ".cache", "agentbrew", "source-checkout-leases");
/** Invocation-owned permission follows async calls. Expired inherited contexts cannot acquire again. */
const checkoutScopes = new AsyncLocalStorage<CheckoutScope>();

function refusal(reason: string): never {
  throw new SourceCheckoutLeaseRefusal(`Source checkout unavailable: ${reason}. No unlocked fallback is allowed.`);
}

/** Resolve aliases and conservatively fold lease-key case so fresh names cannot race on case-insensitive volumes. */
function canonicalCheckoutPath(path: string): string {
  let parent = resolve(path);
  const suffix: string[] = [];
  while (!lstatSync(parent, { throwIfNoEntry: false })) {
    suffix.unshift(basename(parent));
    const next = dirname(parent);
    if (next === parent) refusal("checkout identity is unknown");
    parent = next;
  }
  return join(realpathSync.native(parent), ...suffix);
}

export function sourceCheckoutKey(path: string): string {
  return canonicalCheckoutPath(path).toLowerCase();
}

function assertPrivateDirectory(path: string): Stats {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)
    refusal("lease directory ownership or permissions are unknown");
  return stat;
}

function prepareTargets(targets: readonly SourceCheckoutTarget[]): PreparedTarget[] {
  const prepared = new Map<string, PreparedTarget>();
  for (const target of targets) {
    const actual = canonicalCheckoutPath(target.path);
    const key = actual.toLowerCase();
    const digest = createHash("sha256").update(key).digest("hex");
    prepared.set(actual, {
      actual,
      key,
      label: target.source ? redactUrlCredentials(target.source) : `checkout ${digest.slice(0, 12)}`,
      lockPath: join(LEASE_ROOT, digest),
    });
  }
  return [...prepared.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function ensureLeaseRoot(): void {
  mkdirSync(LEASE_ROOT, { recursive: true, mode: 0o700 });
  assertPrivateDirectory(LEASE_ROOT);
}

function tryAcquire(target: PreparedTarget): HeldCheckout | undefined {
  try {
    mkdirSync(target.lockPath, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    assertPrivateDirectory(target.lockPath);
    return undefined;
  }
  const inode = assertPrivateDirectory(target.lockPath).ino;
  const token = randomUUID();
  writeFileSync(join(target.lockPath, "owner"), JSON.stringify({ token, pid: process.pid }), {
    flag: "wx",
    mode: 0o600,
  });
  return { ...target, inode, token, active: true, poisoned: false };
}

function assertLeaseIdentity(held: HeldCheckout): void {
  const directory = assertPrivateDirectory(held.lockPath);
  const ownerPath = join(held.lockPath, "owner");
  const owner = lstatSync(ownerPath);
  if (
    directory.ino !== held.inode ||
    !owner.isFile() ||
    owner.isSymbolicLink() ||
    owner.uid !== process.getuid?.() ||
    (owner.mode & 0o077) !== 0
  )
    refusal("lease identity changed");
  let record: { token?: unknown; pid?: unknown };
  try {
    record = JSON.parse(readFileSync(ownerPath, "utf8"));
  } catch {
    refusal("lease owner record is unreadable");
  }
  if (!record || typeof record !== "object") refusal("lease owner record is invalid");
  if (record.token !== held.token || record.pid !== process.pid) refusal("lease owner token changed");
}

function inheritedScope(targets: readonly PreparedTarget[]): CheckoutScope | undefined {
  const scope = checkoutScopes.getStore();
  if (!scope) return undefined;
  if (!scope.active) refusal("the owning invocation has ended");
  for (const target of targets) {
    const held = scope.held.get(target.key);
    if (!scope.allowedPaths.has(target.actual)) refusal("a nested operation requested an unreserved canonical path");
    if (!held?.active) refusal("a nested operation requested an unreserved checkout");
    if (held.poisoned) refusal("Git child termination is unknown; its lease is retained for verification");
    assertLeaseIdentity(held);
  }
  return scope;
}

function endScope(scope: CheckoutScope): void {
  const held = [...scope.held.values()].reverse();
  scope.active = false;
  scope.allowedPaths.clear();
  scope.held.clear();
  for (const checkout of held) checkout.active = false;
  const failures: unknown[] = [];
  for (const checkout of held) {
    if (checkout.poisoned) continue;
    try {
      assertLeaseIdentity(checkout);
      unlinkSync(join(checkout.lockPath, "owner"));
      rmdirSync(checkout.lockPath);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length)
    throw new SourceCheckoutLeaseRefusal("Source lease cleanup refused; retained leases need verification", {
      cause: new AggregateError(failures),
    });
}

function assertScopeReadable(scope: CheckoutScope): void {
  if (!scope.active || [...scope.held.values()].some((held) => !held.active || held.poisoned))
    refusal("Git child termination or invocation ownership is unknown; its lease is retained for verification");
  for (const held of scope.held.values()) assertLeaseIdentity(held);
}

async function acquireWaiting(target: PreparedTarget, deadline: number): Promise<HeldCheckout> {
  let reported = false;
  for (;;) {
    const held = tryAcquire(target);
    if (held) return held;
    if (!reported) {
      console.log(`Waiting for another refresh of ${target.label}.`);
      reported = true;
    }
    if (Date.now() >= deadline)
      refusal("checkout is busy or its previous owner needs verification; retry after it is released");
    await new Promise((done) => setTimeout(done, LEASE_POLL_MS));
  }
}

async function runScopedAsync<T>(scope: CheckoutScope, work: () => Promise<T>): Promise<T> {
  try {
    const result = await work();
    assertScopeReadable(scope);
    return result;
  } catch (error) {
    if (isUnknownSourceGitTermination(error)) for (const held of scope.held.values()) held.poisoned = true;
    throw error;
  }
}

function runScopedSync<T>(scope: CheckoutScope, work: () => T): T {
  try {
    const result = work();
    if (result && typeof (result as { then?: unknown }).then === "function") {
      for (const held of scope.held.values()) held.poisoned = true;
      refusal("an asynchronous operation used the synchronous writer boundary");
    }
    assertScopeReadable(scope);
    return result;
  } catch (error) {
    if (isUnknownSourceGitTermination(error)) for (const held of scope.held.values()) held.poisoned = true;
    throw error;
  }
}

/** Reserve the full sorted set before work. Normal release occurs only after all receipt-bound reads finish. */
export async function withSourceCheckoutLeases<T>(
  targets: readonly SourceCheckoutTarget[],
  work: () => Promise<T>,
): Promise<T> {
  const prepared = prepareTargets(targets);
  const inherited = inheritedScope(prepared);
  if (inherited) return runScopedAsync(inherited, work);
  if (prepared.length === 0) return work();
  ensureLeaseRoot();
  const scope: CheckoutScope = {
    active: true,
    held: new Map(),
    allowedPaths: new Set(prepared.map((target) => target.actual)),
  };
  const deadline = Date.now() + LEASE_WAIT_MS;
  try {
    for (const target of prepared) {
      if (!scope.held.has(target.key)) scope.held.set(target.key, await acquireWaiting(target, deadline));
    }
    return await checkoutScopes.run(scope, () => runScopedAsync(scope, work));
  } catch (error) {
    if (isUnknownSourceGitTermination(error)) for (const held of scope.held.values()) held.poisoned = true;
    throw error;
  } finally {
    endScope(scope);
  }
}

/** Synchronous legacy writers refuse contention instead of blocking another invocation's event loop. */
export function withSourceCheckoutLeaseSync<T>(target: SourceCheckoutTarget, work: () => T): T {
  const prepared = prepareTargets([target]);
  const inherited = inheritedScope(prepared);
  if (inherited) return runScopedSync(inherited, work);
  ensureLeaseRoot();
  const scope: CheckoutScope = {
    active: true,
    held: new Map(),
    allowedPaths: new Set(prepared.map((target) => target.actual)),
  };
  try {
    const checkout = tryAcquire(prepared[0] as PreparedTarget);
    if (!checkout) refusal("checkout is busy or its previous owner needs verification; retry after it is released");
    scope.held.set(checkout.key, checkout);
    return checkoutScopes.run(scope, () => runScopedSync(scope, work));
  } catch (error) {
    if (isUnknownSourceGitTermination(error)) for (const held of scope.held.values()) held.poisoned = true;
    throw error;
  } finally {
    endScope(scope);
  }
}

export function assertSourceCheckoutLease(path: string): void {
  if (!inheritedScope(prepareTargets([{ path }]))) refusal("the source writer has no invocation lease");
}

export function isUnknownSourceGitTermination(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const failure = error as { code?: unknown; killed?: unknown; signal?: unknown; cause?: unknown };
  return (
    failure.code === "ETIMEDOUT" ||
    failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ||
    failure.killed === true ||
    typeof failure.signal === "string" ||
    (failure.cause !== error && isUnknownSourceGitTermination(failure.cause))
  );
}

/** Retain the filesystem lease when a timeout/signal does not prove Git descendants stopped. */
export function noteSourceGitFailure(path: string, error: unknown): void {
  if (!isUnknownSourceGitTermination(error)) return;
  const scope = checkoutScopes.getStore();
  const held = scope?.held.get(sourceCheckoutKey(path));
  if (!scope?.active || !held?.active) refusal("unknown Git child termination has no active owner");
  held.poisoned = true;
}

export function sourceCheckoutTerminationUnknown(path: string): boolean {
  return checkoutScopes.getStore()?.held.get(sourceCheckoutKey(path))?.poisoned === true;
}

/** Git-ref helpers also serve private MCP candidates; observe only an already reserved source target. */
export function observeLeasedSourceGit<T>(path: string, work: () => T): T {
  const scope = checkoutScopes.getStore();
  const owned = scope?.active && scope.allowedPaths.has(canonicalCheckoutPath(path));
  if (!owned) return work();
  assertSourceCheckoutLease(path);
  try {
    return work();
  } catch (error) {
    noteSourceGitFailure(path, error);
    throw error;
  }
}
