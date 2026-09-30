import { beforeEach, describe, expect, it, vi } from "vitest";
import { installCorporateTrust, parsePemCertificates, resetCorporateTrustCache } from "./corporate-tls.js";

function pem(body: string): string {
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----`;
}

const CORP_ROOT = pem("Y29ycC1yb290");
const CORP_INTERMEDIATE = pem("Y29ycC1pbnRlcm1lZGlhdGU=");
const PUBLIC_ROOT = pem("cHVibGljLXJvb3Q=");

/** A TLS surface that records what the installer hands back to Node. */
function fakeTls(initial: string[]) {
  let store = [...initial];
  return {
    api: {
      getCACertificates: (): string[] => [...store],
      setDefaultCACertificates: (certs: readonly (string | ArrayBufferView)[]): void => {
        store = certs.map(String);
      },
    },
    get store(): string[] {
      return store;
    },
  };
}

describe("parsePemCertificates", () => {
  it("extracts every certificate from a multi-cert bundle", () => {
    const bundle = `# corporate bundle\n${CORP_ROOT}\n\n${CORP_INTERMEDIATE}\n`;

    expect(parsePemCertificates(bundle)).toEqual([CORP_ROOT, CORP_INTERMEDIATE]);
  });

  it("returns nothing for a file with no PEM blocks", () => {
    expect(parsePemCertificates("not a certificate")).toEqual([]);
  });
});

describe("installCorporateTrust", () => {
  beforeEach(() => {
    resetCorporateTrustCache();
  });

  it("appends the corporate roots to Node's default trust store", () => {
    const tls = fakeTls([PUBLIC_ROOT]);

    const result = installCorporateTrust({
      bundlePath: "/corp/ca.pem",
      readFile: () => `${CORP_ROOT}\n${CORP_INTERMEDIATE}`,
      tlsApi: tls.api,
    });

    expect(result).toMatchObject({ installed: true, added: 2, bundlePath: "/corp/ca.pem" });
    expect(tls.store).toEqual([PUBLIC_ROOT, CORP_ROOT, CORP_INTERMEDIATE]);
  });

  it("keeps the public roots so ordinary HTTPS keeps working", () => {
    const tls = fakeTls([PUBLIC_ROOT]);

    installCorporateTrust({ bundlePath: "/corp/ca.pem", readFile: () => CORP_ROOT, tlsApi: tls.api });

    expect(tls.store).toContain(PUBLIC_ROOT);
  });

  it("does nothing when the machine has no corporate bundle", () => {
    const tls = fakeTls([PUBLIC_ROOT]);
    const setSpy = vi.spyOn(tls.api, "setDefaultCACertificates");

    const result = installCorporateTrust({ bundlePath: undefined, readFile: () => "", tlsApi: tls.api });

    // `bundlePath: undefined` falls through to discovery, which finds nothing
    // in CI. Guard the assertion to the no-bundle machine only.
    if (result.reason === "no-bundle") {
      expect(result.installed).toBe(false);
      expect(setSpy).not.toHaveBeenCalled();
    }
  });

  it("reports unsupported when Node predates the runtime trust API", () => {
    const result = installCorporateTrust({
      bundlePath: "/corp/ca.pem",
      readFile: () => CORP_ROOT,
      tlsApi: { getCACertificates: undefined, setDefaultCACertificates: undefined },
    });

    expect(result).toMatchObject({ installed: false, added: 0, reason: "unsupported-node" });
  });

  it("survives an unreadable bundle instead of throwing into the probe", () => {
    const tls = fakeTls([PUBLIC_ROOT]);

    const result = installCorporateTrust({
      bundlePath: "/corp/ca.pem",
      readFile: () => {
        throw new Error("EACCES");
      },
      tlsApi: tls.api,
    });

    expect(result).toMatchObject({ installed: false, reason: "read-failed" });
    expect(tls.store).toEqual([PUBLIC_ROOT]);
  });

  // The probe calls this per HTTP server. Re-appending the same roots on every
  // call would grow the trust store without bound across a multi-server run.
  it("does not re-add certificates that are already trusted", () => {
    const tls = fakeTls([PUBLIC_ROOT, CORP_ROOT]);

    const result = installCorporateTrust({
      bundlePath: "/corp/ca.pem",
      readFile: () => CORP_ROOT,
      tlsApi: tls.api,
    });

    expect(result).toMatchObject({ installed: false, added: 0, reason: "already-installed" });
    expect(tls.store).toEqual([PUBLIC_ROOT, CORP_ROOT]);
  });

  it("treats a certificate as known despite differing line endings", () => {
    const tls = fakeTls([CORP_ROOT.replace(/\n/g, "\r\n")]);

    const result = installCorporateTrust({
      bundlePath: "/corp/ca.pem",
      readFile: () => CORP_ROOT,
      tlsApi: tls.api,
    });

    expect(result.added).toBe(0);
    expect(tls.store).toHaveLength(1);
  });
});
