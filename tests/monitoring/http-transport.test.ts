import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { executeHttpCheck } from "../../server/monitoring/execute-http-check";

// Only this isolated test fixture bypasses URL validation to exercise native fetch on loopback.
vi.mock("../../server/monitoring/ssrf", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../server/monitoring/ssrf")>();
  return { ...original, validateTargetUrl: async (url: string) => new URL(url) };
});

describe("native HTTP transport", () => {
  let server: Server;
  let baseUrl: string;
  let redirectedRequests = 0;

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === "/hang") return;
      if (request.url === "/network-error") {
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
      response.writeHead(request.url === "/failure" ? 500 : 200).end("fixture");
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture server failed to listen");
    baseUrl = `http://127.0.0.1:${address.port}`;
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
    expect(await check("/network-error")).toMatchObject({
      status: "FAILURE", statusCode: null, failureReason: "Network request failed",
    });
  });

  it("does not send a second request for a redirect", async () => {
    expect(await check("/redirect")).toMatchObject({ status: "FAILURE", statusCode: 302 });
    expect(redirectedRequests).toBe(0);
  });
});
