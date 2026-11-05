import { EventEmitter } from "node:events";
import { afterEach, expect, vi } from "vitest";

interface FixtureAgent {
  options: { keepAlive: boolean };
  destroyed: boolean;
  used: boolean;
  destroy(): void;
}
interface FixtureRequest extends EventEmitter {
  destroyed: boolean;
  destroy(): FixtureRequest;
  end(): FixtureRequest;
}
interface FixtureResponse extends EventEmitter {
  statusCode?: number;
  destroyed: boolean;
  destroy(): FixtureResponse;
}
interface FixtureOptions {
  agent: FixtureAgent;
  hostname: string;
  port: number;
  path: string;
  method: string;
}
const tracking = vi.hoisted(() => ({
  agents: [] as FixtureAgent[],
  requests: [] as FixtureRequest[],
  responses: [] as FixtureResponse[],
}));

vi.mock("node:http", () => {
  class Agent implements FixtureAgent {
    destroyed = false;
    used = false;
    constructor(public options: { keepAlive: boolean }) {
      tracking.agents.push(this);
      expect(options).toEqual({ keepAlive: false });
    }
    destroy() {
      this.destroyed = true;
    }
  }
  interface Port {
    controller: AbortController;
    req: FixtureRequest;
    incoming: FixtureResponse;
    callback: (response: FixtureResponse) => void;
    reader?: ReadableStreamDefaultReader<Uint8Array>;
  }
  function cancel(port: Port) {
    port.controller.abort();
    if (port.reader) {
      void port.reader.cancel().catch(() => {});
      port.reader.releaseLock();
      port.reader = undefined;
    }
  }
  async function pump(port: Port, reader: ReadableStreamDefaultReader<Uint8Array>) {
    for (;;) {
      const part = await reader.read();
      if (port.incoming.destroyed || port.req.destroyed) return;
      if (part.done) {
        port.incoming.emit("end");
        return;
      }
      port.incoming.emit("data", Buffer.from(part.value));
    }
  }
  function forwardError(port: Port, error: unknown) {
    if (port.req.destroyed || port.incoming.destroyed) return;
    if (port.incoming.statusCode !== undefined) port.incoming.emit("error", error);
    else port.req.emit("error", error);
  }
  async function forward(port: Port) {
    try {
      // Reuse the frozen response-byte fixtures through an HTTP event port.
      const response = await fetch("http://127.0.0.1:11434/api/version", {
        method: "GET",
        redirect: "error",
        credentials: "omit",
        signal: port.controller.signal,
      });
      if (port.req.destroyed) {
        void response.body?.cancel().catch(() => {});
        return;
      }
      port.incoming.statusCode = response.status;
      port.reader = response.body?.getReader();
      const reader = port.reader;
      port.callback(port.incoming);
      if (reader && !port.incoming.destroyed && !port.req.destroyed) await pump(port, reader);
    } catch (error) {
      forwardError(port, error);
    } finally {
      if (port.reader) {
        void port.reader.cancel().catch(() => {});
        port.reader.releaseLock();
        port.reader = undefined;
      }
    }
  }
  function request(options: FixtureOptions, callback: (response: FixtureResponse) => void) {
    expect(Object.keys(options).sort()).toEqual(["agent", "hostname", "method", "path", "port"]);
    expect({ ...options, agent: undefined }).toEqual({
      agent: undefined,
      hostname: "127.0.0.1",
      port: 11434,
      path: "/api/version",
      method: "GET",
    });
    expect(options.agent).toBeInstanceOf(Agent);
    expect(options.agent.used).toBe(false);
    options.agent.used = true;
    const req = new EventEmitter() as FixtureRequest;
    const incoming = new EventEmitter() as FixtureResponse;
    const port: Port = { controller: new AbortController(), req, incoming, callback };
    req.destroyed = false;
    incoming.destroyed = false;
    req.destroy = () => {
      req.destroyed = true;
      cancel(port);
      return req;
    };
    incoming.destroy = () => {
      incoming.destroyed = true;
      cancel(port);
      return incoming;
    };
    tracking.requests.push(req);
    tracking.responses.push(incoming);
    req.end = () => {
      void forward(port);
      return req;
    };
    return req;
  }
  return { Agent, request };
});

afterEach(() => {
  expect(tracking.agents.every((agent) => agent.destroyed)).toBe(true);
  expect(tracking.requests.every((request) => request.destroyed)).toBe(true);
  expect(tracking.responses.every((response) => response.destroyed || response.statusCode === undefined)).toBe(true);
  tracking.agents = [];
  tracking.requests = [];
  tracking.responses = [];
});
