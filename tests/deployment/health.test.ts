import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../app/api/health/route";
const mocks = vi.hoisted(() => ({ query: vi.fn(), count: vi.fn() }));
vi.mock("../../server/db/prisma", () => ({ prisma: { $queryRaw: mocks.query, endpoint: { count: mocks.count } } }));

describe("deployment readiness", () => {
  beforeEach(() => {
    vi.stubEnv("APIPULSE_MODE", "demo"); vi.stubEnv("DEMO_BASE_URL", "https://demo.example.com");
    mocks.query.mockReset().mockResolvedValue([{ statement: "10s", lock: "3s", idle: "10s" }]);
    mocks.count.mockReset().mockResolvedValue(3);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllEnvs());
  it("checks actual database configuration/schema without exposing its credentials", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", mode: "demo" });
    expect(mocks.count).toHaveBeenCalledOnce();
  });
  it.each(["database", "deadlines", "origin"])("fails generically when %s is not ready", async scenario => {
    if (scenario === "database") mocks.count.mockRejectedValue(new Error("postgresql://user:secret@private"));
    if (scenario === "deadlines") mocks.query.mockResolvedValue([{ statement: "0", lock: "0", idle: "0" }]);
    if (scenario === "origin") vi.stubEnv("DEMO_BASE_URL", "");
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret");
  });
});
