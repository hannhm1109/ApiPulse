import { describe, expect, it } from "vitest";
import { buildDashboard, deriveHealth, RECENT_CHECK_LIMIT } from "../../server/dashboard/health-summary";
import type { CheckObservation, DashboardSourceEndpoint } from "../../server/dashboard/types";

const now = new Date("2026-10-08T16:00:00Z");
const endpoint = { enabled: true, checkIntervalMinutes: 5 };
const check = (status: CheckObservation["status"] = "SUCCESS", age = 60_000, fields = {}): CheckObservation => ({
  id: "check", checkedAt: new Date(now.getTime() - age), status, statusCode: 200, responseTimeMs: 142, failureReason: null, ...fields,
});
const row = (id: string, fields: Partial<DashboardSourceEndpoint> = {}): DashboardSourceEndpoint => ({
  id, name: id, url: "https://example.com/health", ...endpoint, checkResults: [check()], incidents: [], ...fields,
});

describe("observed endpoint health", () => {
  it("never treats an unobserved enabled endpoint as healthy", () => {
    expect(deriveHealth(endpoint, null, now)).toBe("PENDING");
  });
  it.each(["SUCCESS", "FAILURE", "TIMEOUT"] as const)("disabled overrides a historical %s result", status => {
    expect(deriveHealth({ ...endpoint, enabled: false }, check(status), now)).toBe("DISABLED");
  });
  it.each([["SUCCESS", "UP"], ["FAILURE", "DOWN"], ["TIMEOUT", "DOWN"]] as const)("maps a fresh %s observation to %s", (status, health) => {
    expect(deriveHealth(endpoint, check(status), now)).toBe(health);
  });
  it.each([1, 5, 10])("the exact two-interval boundary is fresh for interval %s", checkIntervalMinutes => {
    const age = checkIntervalMinutes * 2 * 60_000;
    expect(deriveHealth({ ...endpoint, checkIntervalMinutes }, check("SUCCESS", age), now)).toBe("UP");
    expect(deriveHealth({ ...endpoint, checkIntervalMinutes }, check("SUCCESS", age + 1), now)).toBe("STALE");
  });
  it("a stale failure is not asserted as currently down", () => {
    expect(deriveHealth(endpoint, check("FAILURE", 600_001), now)).toBe("STALE");
  });
  it("a future timestamp is unknown, not healthy or stale", () => {
    expect(deriveHealth(endpoint, check("SUCCESS", -1), now)).toBe("UNKNOWN");
  });
  it.each([0, -1, 1.5, NaN])("an invalid interval %s cannot imply fresh health", checkIntervalMinutes => {
    expect(deriveHealth({ ...endpoint, checkIntervalMinutes }, check(), now)).toBe("UNKNOWN");
  });
  it("invalid dates cannot imply healthy", () => {
    expect(deriveHealth(endpoint, check("SUCCESS", 1, { checkedAt: new Date("invalid") }), now)).toBe("UNKNOWN");
  });
});

describe("dashboard projection", () => {
  it("an empty database returns zero counts, not fabricated healthy values", () => {
    expect(buildDashboard([], now)).toEqual({ generatedAt: now.toISOString(), endpoints: [], incidents: [],
      counts: { total: 0, healthy: 0, down: 0, pending: 0, stale: 0, disabled: 0, unknown: 0, activeIncidents: 0 } });
  });
  it("partitions endpoints and counts open incidents independently, including disabled ones", () => {
    const data = buildDashboard([
      row("healthy"), row("failure", { checkResults: [check("FAILURE")] }),
      row("timeout", { checkResults: [check("TIMEOUT", 1000, { statusCode: null })] }),
      row("pending", { checkResults: [] }), row("stale", { checkResults: [check("SUCCESS", 600_001)] }),
      row("future", { checkResults: [check("SUCCESS", -1000)] }),
      row("disabled", { enabled: false, incidents: [{ id: "incident", startedAt: new Date(now.getTime() - 90_000), cause: "Unhealthy" }] }),
    ], now);
    expect(data.counts).toEqual({ total: 7, healthy: 1, down: 2, pending: 1, stale: 1, disabled: 1, unknown: 1, activeIncidents: 1 });
    expect(data.incidents[0]).toMatchObject({ endpointId: "disabled", enabled: false });
    expect(data.endpoints.map(item => item.health)).toEqual(["DOWN", "DOWN", "STALE", "UNKNOWN", "PENDING", "UP", "DISABLED"]);
  });
  it("keeps zero response timing and exposes no latency for a response-less timeout", () => {
    const data = buildDashboard([row("zero", { checkResults: [check("SUCCESS", 1000, { responseTimeMs: 0 })] }),
      row("timeout", { checkResults: [check("TIMEOUT", 1000, { statusCode: null, responseTimeMs: 5000 })] })], now);
    expect(data.endpoints.find(item => item.id === "zero")!.latencyMs).toBe(0);
    expect(data.endpoints.find(item => item.id === "timeout")!.latencyMs).toBeNull();
  });
  it("uses the latest HTTP failure's timing rather than an older successful latency", () => {
    const data = buildDashboard([row("failure", { checkResults: [check("FAILURE", 1000, { statusCode: 503, responseTimeMs: 240 }), check()] })], now);
    expect(data.endpoints[0]).toMatchObject({ health: "DOWN", latencyMs: 240 });
  });
  it("limits recent observations and serializes timestamps without copying extra endpoint fields", () => {
    const source = { ...row("limited"), checkClaimToken: "private", lastCheckedAt: now,
      checkResults: Array.from({ length: 20 }, (_, index) => check("SUCCESS", index * 1000, { id: String(index) })) };
    const data = buildDashboard([source], now);
    expect(data.endpoints[0].recentChecks).toHaveLength(RECENT_CHECK_LIMIT);
    expect(data.endpoints[0].latestCheck!.checkedAt).toBe(now.toISOString());
    expect(data.endpoints[0]).not.toHaveProperty("checkClaimToken");
    expect(data.endpoints[0]).not.toHaveProperty("lastCheckedAt");
  });
  it("shows oldest active incidents first, rather than hiding a long-running disabled incident", () => {
    const data = buildDashboard([row("new", { incidents: [{ id: "new", startedAt: now, cause: "new" }] }),
      row("old", { enabled: false, incidents: [{ id: "old", startedAt: new Date(now.getTime() - 60_000), cause: "old" }] })], now);
    expect(data.incidents.map(item => item.id)).toEqual(["old", "new"]);
  });
});
