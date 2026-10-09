import { beforeEach, describe, expect, it, vi } from "vitest";
import { smokeDeployment } from "../../scripts/smoke-deployment";

describe("deployment smoke verification", () => {
  const summary = { claimed: 3, success: 2, failure: 1, timeout: 0, skipped: 0, errors: 0 };
  const fetchMock = vi.fn<typeof fetch>();
  let scenario = "ready";
  beforeEach(() => {
    scenario = "ready";
    fetchMock.mockReset().mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      const headers = { "cache-control": "no-store", "x-frame-options": "DENY" };
      if (path === "/api/health") return Response.json({ status: "ok", mode: scenario === "local" ? "local" : "demo" }, { status: scenario === "database" ? 503 : 200, headers });
      if (init?.method === "POST") return new Response(null, { status: scenario === "writes" ? 200 : 403, headers });
      if (path.endsWith("/edit") || path === "/endpoints/new") return new Response(null, { status: scenario === "management" ? 200 : 404, headers });
      if (path === "/api/cron/checks") return init?.headers ? Response.json({ ...summary, errors: scenario === "internal" ? 1 : 0, success: scenario === "internal" ? 1 : 2 }) : new Response(null, { status: scenario === "cron" ? 200 : 401, headers });
      if (path.startsWith("/api/demo/")) {
        const kind = path.split("/").at(-1);
        return Response.json({ demo: scenario !== "target", service: kind }, { status: kind === "recovery" ? 503 : 200, headers });
      }
      return new Response(scenario === "seed" ? "API Pulse" : "API Pulse Demo Healthy API Demo Slow API Demo Recovery API", { headers });
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  it("verifies public readiness and access without running authenticated checks by default", async () => {
    await expect(smokeDeployment("https://demo.example.com")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(13);
    expect(fetchMock.mock.calls.every(([, options]) => options?.redirect === "manual" && options.signal instanceof AbortSignal)).toBe(true);
    expect(fetchMock.mock.calls.some(([, options]) => options?.headers)).toBe(false);
  });
  it("requires explicit opt-in to execute one authenticated batch and accepts normal target failures", async () => {
    await expect(smokeDeployment("https://demo.example.com", { runChecks: true, secret: "fixture-secret-long-enough" })).resolves.toEqual(summary);
    expect(fetchMock).toHaveBeenCalledTimes(14);
    expect(fetchMock.mock.calls.filter(([, options]) => options?.headers)).toHaveLength(1);
  });
  it.each(["database", "local", "writes", "management", "cron", "seed", "target"])("rejects a deployment with incorrect %s behavior", async value => {
    scenario = value;
    await expect(smokeDeployment("https://demo.example.com")).rejects.toThrow();
  });
  it("fails a real-check smoke when the scheduler reports an internal error", async () => {
    scenario = "internal";
    await expect(smokeDeployment("https://demo.example.com", { runChecks: true, secret: "fixture-secret-long-enough" })).rejects.toThrow("internal errors");
  });
});
