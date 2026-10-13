import { describe, expect, it, vi } from "vitest";
import { mcpRegistryEnabled, resolveRegistryServer, toCatalogMcpServer } from "./mcp-registry.js";

const CONTEXT7 = {
  name: "io.github.upstash/context7",
  description: "Up-to-date code docs for any prompt",
  version: "4.3.0",
  packages: [
    {
      registryType: "npm",
      identifier: "@upstash/context7-mcp",
      version: "4.3.0",
      transport: { type: "stdio" },
      environmentVariables: [{ name: "CONTEXT7_API_KEY", isSecret: true }],
    },
  ],
};

const REMOTE_ONLY = {
  name: "ai.example/remote-docs",
  description: "Remote docs",
  version: "1.0.0",
  remotes: [
    {
      type: "streamable-http",
      url: "https://docs.example.com/mcp",
      headers: [{ name: "Authorization", value: "Bearer {docs_api_key}" }],
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("mcpRegistryEnabled", () => {
  it("is off unless AGENTBREW_MCP_REGISTRY=1", () => {
    expect(mcpRegistryEnabled({})).toBe(false);
    expect(mcpRegistryEnabled({ AGENTBREW_MCP_REGISTRY: "0" })).toBe(false);
    expect(mcpRegistryEnabled({ AGENTBREW_MCP_REGISTRY: "1" })).toBe(true);
  });
});

describe("toCatalogMcpServer", () => {
  it("maps an npm stdio package to a pinned npx command", () => {
    expect(toCatalogMcpServer(CONTEXT7)).toMatchObject({
      name: "context7",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp@4.3.0"],
      category: "registry",
      recommended: false,
    });
  });

  it("puts only required env vars in env and names the optional ones in the note", () => {
    const server = toCatalogMcpServer({
      ...CONTEXT7,
      packages: [
        {
          ...CONTEXT7.packages[0],
          environmentVariables: [
            { name: "REQ_TOKEN", isRequired: true },
            { name: "CONTEXT7_API_KEY", isSecret: true },
          ],
        },
      ],
    });
    expect(server?.env).toEqual({ REQ_TOKEN: "${REQ_TOKEN}" });
    expect(server?.note).toContain("CONTEXT7_API_KEY");
  });

  it("maps a pypi stdio package to uvx", () => {
    const server = toCatalogMcpServer({
      name: "io.github.example/py-tool",
      description: "Python tool",
      version: "2.0.0",
      packages: [{ registryType: "pypi", identifier: "py-tool", version: "2.0.0", transport: { type: "stdio" } }],
    });
    expect(server).toMatchObject({ name: "py-tool", command: "uvx", args: ["py-tool==2.0.0"] });
  });

  it("maps a remote-only server to its url and turns {placeholders} into ${ENV}", () => {
    expect(toCatalogMcpServer(REMOTE_ONLY)).toMatchObject({
      name: "remote-docs",
      url: "https://docs.example.com/mcp",
      headers: { Authorization: "Bearer ${DOCS_API_KEY}" },
    });
  });

  it("keeps the namespace when the last name segment is generic", () => {
    expect(toCatalogMcpServer({ ...REMOTE_ONLY, name: "ac.inference.sh/mcp" })?.name).toBe("ac-inference-sh-mcp");
    expect(toCatalogMcpServer({ ...REMOTE_ONLY, name: "io.example/server" })?.name).toBe("io-example-server");
  });

  it("returns undefined when no package or remote is usable", () => {
    expect(
      toCatalogMcpServer({
        name: "x/y",
        description: "",
        version: "1",
        packages: [{ registryType: "oci", identifier: "img" }],
      }),
    ).toBeUndefined();
  });
});

describe("resolveRegistryServer", () => {
  it("looks up a full registry name through versions/latest", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ server: CONTEXT7 }));
    const result = await resolveRegistryServer("io.github.upstash/context7", { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://registry.modelcontextprotocol.io/v0/servers/io.github.upstash%2Fcontext7/versions/latest",
      expect.anything(),
    );
    expect(result).toMatchObject({
      ok: true,
      registryName: "io.github.upstash/context7",
      server: { name: "context7" },
    });
  });

  it("resolves a short name when exactly one latest server ends with it", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ servers: [{ server: CONTEXT7 }, { server: { ...REMOTE_ONLY, name: "ai.x/context7-fork" } }] }),
    );
    const result = await resolveRegistryServer("context7", { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://registry.modelcontextprotocol.io/v0/servers?search=context7&version=latest",
      expect.anything(),
    );
    expect(result).toMatchObject({ ok: true, registryName: "io.github.upstash/context7" });
  });

  it("reports ambiguous when several servers end with the short name", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ servers: [{ server: CONTEXT7 }, { server: { ...CONTEXT7, name: "ai.other/context7" } }] }),
    );
    expect(await resolveRegistryServer("context7", { fetchImpl })).toMatchObject({ ok: false, reason: "ambiguous" });
  });

  it("reports not-found on a 404 or an empty search", async () => {
    expect(await resolveRegistryServer("a/b", { fetchImpl: vi.fn(async () => jsonResponse({}, 404)) })).toMatchObject({
      ok: false,
      reason: "not-found",
    });
    expect(
      await resolveRegistryServer("nothing", { fetchImpl: vi.fn(async () => jsonResponse({ servers: [] })) }),
    ).toMatchObject({ ok: false, reason: "not-found" });
  });

  it("reports unreachable, never throws, when the network fails or the server errors", async () => {
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await resolveRegistryServer("context7", { fetchImpl: offline })).toMatchObject({
      ok: false,
      reason: "unreachable",
    });
    expect(
      await resolveRegistryServer("context7", { fetchImpl: vi.fn(async () => jsonResponse({}, 503)) }),
    ).toMatchObject({ ok: false, reason: "unreachable" });
  });

  it("reports unsupported when the server has no usable package or remote", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ server: { name: "x/y", description: "", version: "1", packages: [{ registryType: "oci" }] } }),
    );
    expect(await resolveRegistryServer("x/y", { fetchImpl })).toMatchObject({ ok: false, reason: "unsupported" });
  });
});
