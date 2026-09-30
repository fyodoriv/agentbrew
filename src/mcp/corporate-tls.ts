/**
 * Teach this Node process to trust the corporate TLS-interception CA.
 *
 * On a machine behind a TLS-inspecting proxy (a corporate security gateway) every
 * HTTPS response is re-signed by a corporate root. macOS installs that root in
 * the system keychain, so `curl` works and the machine looks healthy — but
 * Node ships its own compiled-in CA list and ignores the keychain, so
 * `fetch()` fails with `unable to get local issuer certificate`. For the MCP
 * probe that surfaces as `init_error: fetch failed` against *every* remote
 * HTTPS MCP, which reads as "the server is down" when the server is fine.
 *
 * `endpoint-repair.ts` already solves this for spawned Python servers by
 * writing `SSL_CERT_FILE` / `REQUESTS_CA_BUNDLE` into their env. That does
 * nothing for requests agentbrew makes itself, because a child's env cannot
 * change this process's trust store. `NODE_EXTRA_CA_CERTS` and
 * `--use-system-ca` are both read at interpreter start, so neither can be
 * applied from inside a CLI that is already running.
 *
 * `tls.setDefaultCACertificates()` (Node >= 22.15) is the one lever that works
 * at runtime, and it applies globally — `fetch`, `undici`, and `node:https`
 * all pick it up with no new dependency and no re-exec.
 */

import { readFileSync } from "node:fs";
import tls from "node:tls";
import { resolveCorporateCaBundle } from "./endpoint-repair.js";

const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;

export interface CorporateTrustResult {
  /** True when this call added certificates to the process trust store. */
  installed: boolean;
  /** Bundle the certificates came from, when one was found. */
  bundlePath?: string;
  /** Number of certificates added (0 when already trusted or unavailable). */
  added: number;
  /** Why nothing was installed, for callers that want to log it. */
  reason?: "no-bundle" | "unsupported-node" | "already-installed" | "read-failed";
}

/** Extract the PEM blocks from a bundle, ignoring comments and stray text. */
export function parsePemCertificates(pem: string): string[] {
  return pem.match(PEM_CERTIFICATE) ?? [];
}

/**
 * Normalize a PEM block so the same certificate compares equal regardless of
 * line endings or surrounding whitespace, which differ between bundles.
 */
function fingerprint(pem: string): string {
  return pem.replace(/\s+/g, "");
}

export interface InstallCorporateTrustOptions {
  /** Override bundle discovery (tests). */
  bundlePath?: string;
  /** Override file reads (tests). */
  readFile?: (path: string) => string;
  /** Override the TLS surface (tests, and older Node without the API). */
  tlsApi?: Partial<Pick<typeof tls, "getCACertificates" | "setDefaultCACertificates">>;
}

let cachedResult: CorporateTrustResult | undefined;

/**
 * Add the corporate CA to this process's default trust store.
 *
 * Safe to call anywhere: it is a no-op off a corporate network (no bundle), on
 * Node without the runtime API, and on every call after the first.
 */
export function installCorporateTrust(options: InstallCorporateTrustOptions = {}): CorporateTrustResult {
  const isDefaultCall = Object.keys(options).length === 0;
  if (isDefaultCall && cachedResult) return { ...cachedResult, installed: false, reason: "already-installed" };

  const result = computeInstall(options);
  if (isDefaultCall) cachedResult = result;
  return result;
}

function computeInstall(options: InstallCorporateTrustOptions): CorporateTrustResult {
  // An explicit `tlsApi` replaces the real surface outright. Falling back
  // per-member would let a test that pins a member to `undefined` (to stand in
  // for older Node) reach the live trust store instead.
  const surface = options.tlsApi ?? tls;
  const { getCACertificates, setDefaultCACertificates } = surface;
  if (typeof getCACertificates !== "function" || typeof setDefaultCACertificates !== "function") {
    return { installed: false, added: 0, reason: "unsupported-node" };
  }

  const bundlePath = options.bundlePath ?? resolveCorporateCaBundle();
  if (!bundlePath) return { installed: false, added: 0, reason: "no-bundle" };

  let bundle: string;
  try {
    bundle = (options.readFile ?? ((p: string) => readFileSync(p, "utf-8")))(bundlePath);
  } catch {
    return { installed: false, added: 0, bundlePath, reason: "read-failed" };
  }

  const existing = getCACertificates("default");
  const known = new Set(existing.map(fingerprint));
  const additions = parsePemCertificates(bundle).filter((cert) => !known.has(fingerprint(cert)));
  if (additions.length === 0) {
    return { installed: false, added: 0, bundlePath, reason: "already-installed" };
  }

  setDefaultCACertificates([...existing, ...additions]);
  return { installed: true, added: additions.length, bundlePath };
}

/** Reset the once-per-process guard. Tests only. */
export function resetCorporateTrustCache(): void {
  cachedResult = undefined;
}
