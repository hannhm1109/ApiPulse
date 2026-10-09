import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { executeHttpCheck } from "../../server/monitoring/execute-http-check";

// Only this isolated fixture permits its pinned loopback destination; production validation still rejects it.
vi.mock("../../server/monitoring/ssrf", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../server/monitoring/ssrf")>();
  return { ...original, validateTargetUrl: async (url: string) => ({ url: new URL(url), address: { address: "127.0.0.1", family: 4 } }) };
});

describe("native HTTP transport", () => {
  let server: Server;
  let baseUrl: string;
  let redirectedRequests = 0;
  const hosts: (string | undefined)[] = [];
  let networkRequests = 0;

  beforeAll(async () => {
    server = createServer((request, response) => {
      hosts.push(request.headers.host);
      if (request.url === "/hang") return;
      if (request.url === "/network-error") {
        networkRequests++;
        request.socket.destroy();
        return;
      }
      if (request.url === "/redirect") {
        response.writeHead(302, { Location: `${baseUrl}/redirected` }).end();
        return;
      }
      if (request.url === "/redirected") redirectedRequests++;
      if (request.url === "/headers-only") {
        response.writeHead(200);
        response.flushHeaders();
        return;
      }
      if (request.url === "/large-headers") {
        response.writeHead(200, { "X-Large-Header": "x".repeat(100_000) }).end();
        return;
      }
      response.writeHead(request.url === "/failure" ? 500 : 200).end("fixture");
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture server failed to listen");
    baseUrl = `http://fixture.example:${address.port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  const check = (path: string, timeoutMs = 1000) => executeHttpCheck({
    url: `${baseUrl}${path}`, expectedStatusCode: 200, timeoutMs,
  });

  it("observes real healthy and failing HTTP responses", async () => {
    expect(await check("/healthy")).toMatchObject({ status: "SUCCESS", statusCode: 200 });
    expect(await check("/failure")).toMatchObject({ status: "FAILURE", statusCode: 500 });
    expect(hosts.slice(-2)).toEqual([new URL(baseUrl).host, new URL(baseUrl).host]);
  });

  it("returns when headers arrive even if the body never finishes", async () => {
    expect(await check("/headers-only")).toMatchObject({ status: "SUCCESS", statusCode: 200 });
  });

  it("times out a real hanging HTTP request", async () => {
    const result = await check("/hang", 50);
    expect(result).toMatchObject({ status: "TIMEOUT", statusCode: null });
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(40);
  });

  it("records a connection closed without a response", async () => {
    const before = networkRequests;
    expect(await check("/network-error")).toMatchObject({
      status: "FAILURE", statusCode: null, failureReason: "Network request failed",
    });
    expect(networkRequests - before).toBe(1);
  });

  it("does not send a second request for a redirect", async () => {
    expect(await check("/redirect")).toMatchObject({ status: "FAILURE", statusCode: 302 });
    expect(redirectedRequests).toBe(0);
  });
  it("bounds response header parsing rather than accepting an unlimited header", async () => {
    expect(await check("/large-headers")).toMatchObject({ status: "FAILURE", statusCode: null, failureReason: "Network request failed" });
  });
});
