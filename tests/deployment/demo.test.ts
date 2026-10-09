import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import { getDemoOrigin } from "../../server/demo/config";
import { demoObservation } from "../../server/demo/response";
import { validateTargetUrl } from "../../server/monitoring/ssrf";
import { GET } from "../../app/api/demo/[kind]/route";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

describe("controlled demo services", () => {
  beforeEach(() => {
    vi.stubEnv("APIPULSE_MODE", "demo");
    vi.stubEnv("DEMO_BASE_URL", "https://demo.example.com");
    vi.mocked(lookup).mockReset().mockResolvedValue([{ address: "8.8.8.8", family: 4 }] as never);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

  it.each(["", "http://demo.example.com", "https://user:secret@demo.example.com", "https://demo.example.com/path", "https://demo.example.com?x=1", "https://demo.example.com:8443", "https://127.0.0.1"])(
    "rejects unsafe origin configuration without reflecting secrets", value => {
      vi.stubEnv("DEMO_BASE_URL", value);
      expect(getDemoOrigin).toThrow("public HTTPS origin");
    },
  );

  it.each(["https://outside.example.com/api/demo/healthy", "https://demo.example.com/other", "https://demo.example.com/api/demo/healthy?url=http://localhost", "https://demo.example.com/api/demo/healthy/"])(
    "rejects targets outside the exact allowlist before DNS: %s", async url => {
      await expect(validateTargetUrl(url)).rejects.toThrow("restricted");
      expect(lookup).not.toHaveBeenCalled();
    },
  );

  it("allows the configured demo path but still rejects DNS rebinding/private addresses", async () => {
    expect(await validateTargetUrl("https://demo.example.com/api/demo/healthy")).toMatchObject({ address: { address: "8.8.8.8" } });
    vi.mocked(lookup).mockResolvedValue([{ address: "127.0.0.1", family: 4 }] as never);
    await expect(validateTargetUrl("https://demo.example.com/api/demo/healthy")).rejects.toThrow("public IP");
  });

  it.each([[0, 503], [9 * 60_000 + 59_999, 503], [10 * 60_000, 200], [30 * 60_000 - 1, 200], [30 * 60_000, 503]])(
    "has deterministic failure/recovery boundaries at %s ms", (time, statusCode) => {
      expect(demoObservation("recovery", new Date(time)).statusCode).toBe(statusCode);
    },
  );

  it("keeps healthy/slow behavior stable and rejects invalid clocks", () => {
    expect(demoObservation("healthy", new Date(0))).toEqual({ statusCode: 200, delayMs: 0 });
    expect(demoObservation("slow", new Date(0))).toEqual({ statusCode: 200, delayMs: 750 });
    expect(() => demoObservation("healthy", new Date(NaN))).toThrow(RangeError);
  });

  it.each(["healthy", "slow", "recovery", "unknown"])("serves fixed uncached responses without caller-controlled state: %s", async kind => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(0));
    const responsePromise = GET(new Request("https://demo.example.com/api/demo/healthy?status=200"), { params: Promise.resolve({ kind }) });
    await vi.advanceTimersByTimeAsync(750);
    const response = await responsePromise;
    expect(response.status).toBe(kind === "unknown" ? 404 : kind === "recovery" ? 503 : 200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    if (kind !== "unknown") expect(await response.json()).toMatchObject({ demo: true, service: kind });
  });
});
