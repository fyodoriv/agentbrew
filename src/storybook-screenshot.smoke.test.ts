import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo as TcpAddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "..");
const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const stories = [
  { id: "button--primary", name: "Primary", title: "Button" },
  { id: "app/components:card default", name: "Default", title: "App / Components / Card" },
];

describe("storybook-screenshot binary smoke", () => {
  let server: Server;
  let baseUrl: string;
  let outputRoot: string;

  beforeAll(async () => {
    outputRoot = mkdtempSync(join(tmpdir(), "agentbrew-storybook-smoke-"));
    server = createFixtureServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        const address = readTcpAddress(server);
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
    await execFileAsync("npm", ["run", "build"], { cwd: repoRoot, timeout: 120_000 });
  }, 130_000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (outputRoot) rmSync(outputRoot, { force: true, recursive: true });
  });

  it("captures all fixture stories as PNG files", { timeout: 60_000 }, async () => {
    const outDir = join(outputRoot, "screenshots");

    await execFileAsync(
      process.execPath,
      ["dist/storybook-screenshot.js", "--all", "--base-url", baseUrl, "--out-dir", outDir],
      { cwd: repoRoot, timeout: 60_000 },
    );

    expect(readPngSignature(join(outDir, "button--primary.png"))).toEqual(pngSignature);
    expect(readPngSignature(join(outDir, "app-components-card-default.png"))).toEqual(pngSignature);
  });
});

function createFixtureServer(): Server {
  return createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname === "/index.json") {
      writeJson(response, { entries: Object.fromEntries(stories.map(toEntry)) });
      return;
    }
    if (requestUrl.pathname === "/iframe.html") {
      writeHtml(response, requestUrl.searchParams.get("id") ?? "");
      return;
    }
    response.writeHead(404).end("not found");
  });
}

function readTcpAddress(server: Server): TcpAddressInfo {
  const address = server.address();
  if (typeof address === "object" && address !== null) {
    return address;
  }
  throw new Error("fixture server did not bind to a TCP address");
}

function toEntry(story: (typeof stories)[number]): [string, (typeof stories)[number] & { type: "story" }] {
  return [story.id, { ...story, type: "story" }];
}

function writeJson(response: ServerResponse, payload: unknown): void {
  response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(payload));
}

function writeHtml(response: ServerResponse, storyId: string): void {
  const safeStoryId = storyId.replace(/[&<>"']/g, "");
  response
    .writeHead(200, { "content-type": "text/html" })
    .end(`<!doctype html><html><body><main data-story-id="${safeStoryId}">${safeStoryId}</main></body></html>`);
}

function readPngSignature(filePath: string): number[] {
  return [...readFileSync(filePath).subarray(0, pngSignature.length)];
}
