import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { getEndpointDetail } from "../../server/endpoint-detail/detail-service";
import { LATENCY_CHART_LIMIT, historyWindowStart } from "../../server/endpoint-detail/history-metrics";
import { persistCheckResult } from "../../server/monitoring/persist-check-result";

describe("endpoint history in PostgreSQL", () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error("Set TEST_DATABASE_URL to run database tests.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 3, connectionTimeoutMillis: 5000 }) });
  const prefix = `test-detail-${randomUUID()}-`;
  const ownRows = { id: { startsWith: prefix } };
  const now = new Date("2026-10-08T16:00:00Z");
  const create = (suffix: string, fields = {}) => db.endpoint.create({ data: { id: `${prefix}${suffix}`, name: suffix, url: "https://example.com/health", enabled: true, ...fields } });
  const outcome = (age: number, status: "SUCCESS" | "FAILURE" | "TIMEOUT" = "SUCCESS", ms = 100) => ({
    checkedAt: new Date(now.getTime() - age), status, statusCode: status === "TIMEOUT" ? null : status === "FAILURE" ? 503 : 200,
    responseTimeMs: ms, failureReason: status === "SUCCESS" ? null : "Fixture failure",
  });
  beforeEach(async () => { await db.endpoint.deleteMany({ where: ownRows }); });
  afterAll(async () => { try { await db.endpoint.deleteMany({ where: ownRows }); } finally { await db.$disconnect(); } });

  it("returns a genuine empty history with no uptime or invented timings", async () => {
    const endpoint = await create("empty", { lastCheckedAt: now });
    const data = (await getEndpointDetail(db, endpoint.id, {}, now))!;
    expect(data).toMatchObject({ health: "PENDING", latencyMs: null, latestCheck: null, activeIncident: null,
      metrics: { total: 0, uptimePercent: null, averageLatencyMs: null, responseCount: 0 }, checks: { items: [], page: 1, pages: 1 }, incidents: { items: [] }, chartChecks: [] });
  });
  it("computes the full denominator and average independently of pagination and chart cap", async () => {
    const endpoint = await create("many");
    await db.checkResult.createMany({ data: Array.from({ length: 260 }, (_, index) => ({ endpointId: endpoint.id,
      ...outcome(index * 1000, index < 130 ? "SUCCESS" : index < 195 ? "FAILURE" : "TIMEOUT", index < 130 ? 0 : index < 195 ? 300 : 5000) })) });
    const data = (await getEndpointDetail(db, endpoint.id, { checkPage: "2" }, now))!;
    expect(data.metrics).toEqual({ total: 260, successful: 130, failed: 65, timedOut: 65, uptimePercent: 50, averageLatencyMs: 100, responseCount: 195 });
    expect(data.chartChecks).toHaveLength(LATENCY_CHART_LIMIT);
    expect(data.checks).toMatchObject({ total: 260, page: 2, pages: 11 });
    expect(data.checks.items).toHaveLength(25);
    expect(data.checks.items[0].checkedAt).toBe(new Date(now.getTime() - 25_000).toISOString());
    expect(data.latencyMs).toBe(0);
  });
  it.each(["24h", "7d", "30d"] as const)("includes exact %s window boundaries, excluding older and future results", async period => {
    const endpoint = await create(`window-${period}`);
    const start = historyWindowStart(period, now);
    await db.checkResult.createMany({ data: [start, new Date(start.getTime() - 1), now, new Date(now.getTime() + 1)].map(checkedAt => ({ endpointId: endpoint.id, ...outcome(0), checkedAt })) });
    const data = (await getEndpointDetail(db, endpoint.id, { period }, now))!;
    expect(data.windowStart).toBe(start.toISOString());
    expect(data.metrics.total).toBe(2);
    expect(data.checks.items.map(check => check.checkedAt)).toEqual([now.toISOString(), start.toISOString()]);
    expect(data.health).toBe("UNKNOWN");
  });
  it("tracks actual incident recovery and later relapse with fixed resolved durations", async () => {
    const endpoint = await create("lifecycle");
    await persistCheckResult(db, endpoint.id, outcome(90_000, "FAILURE"));
    await persistCheckResult(db, endpoint.id, outcome(60_000, "TIMEOUT", 5000));
    const down = (await getEndpointDetail(db, endpoint.id, {}, now))!;
    expect(down).toMatchObject({ health: "DOWN", latencyMs: null, incidents: { total: 1 }, activeIncident: { durationMs: 90_000 } });
    await persistCheckResult(db, endpoint.id, outcome(30_000));
    const recovered = (await getEndpointDetail(db, endpoint.id, {}, now))!;
    expect(recovered).toMatchObject({ health: "UP", activeIncident: null, metrics: { total: 3, successful: 1, timedOut: 1 } });
    expect(recovered.incidents.items[0]).toMatchObject({ status: "RESOLVED", durationMs: 60_000, resolvedAt: new Date(now.getTime() - 30_000).toISOString() });
    await persistCheckResult(db, endpoint.id, outcome(10_000, "FAILURE"));
    const relapse = (await getEndpointDetail(db, endpoint.id, {}, now))!;
    expect(relapse.incidents.total).toBe(2);
    expect(relapse.activeIncident!.durationMs).toBe(10_000);
    expect(relapse.incidents.items.map(incident => incident.status)).toEqual(["OPEN", "RESOLVED"]);
  });
  it("retains historical metrics and open incidents when monitoring is disabled", async () => {
    const endpoint = await create("disabled");
    await persistCheckResult(db, endpoint.id, outcome(30_000, "FAILURE"));
    await db.endpoint.update({ where: { id: endpoint.id }, data: { enabled: false } });
    expect(await getEndpointDetail(db, endpoint.id, {}, now)).toMatchObject({ health: "DISABLED", metrics: { total: 1, uptimePercent: 0 }, activeIncident: { status: "OPEN" } });
  });
  it("separates latest health from the selected metrics window and excludes other endpoints", async () => {
    const endpoint = await create("old");
    const other = await create("other");
    await db.checkResult.create({ data: { endpointId: endpoint.id, ...outcome(2 * 86_400_000, "FAILURE", 250) } });
    await db.checkResult.create({ data: { endpointId: other.id, ...outcome(0) } });
    const data = (await getEndpointDetail(db, endpoint.id, { period: "24h" }, now))!;
    expect(data).toMatchObject({ health: "STALE", latencyMs: 250, metrics: { total: 0, uptimePercent: null }, checks: { items: [] } });
    expect(data.latestCheck!.status).toBe("FAILURE");
  });
  it("returns deterministic tie order and clamps large or invalid page requests", async () => {
    const endpoint = await create("ties");
    await db.checkResult.createMany({ data: Array.from({ length: 26 }, (_, index) => ({ id: `${prefix}check-${String(index).padStart(2, "0")}`, endpointId: endpoint.id, ...outcome(0), createdAt: now })) });
    const page1 = (await getEndpointDetail(db, endpoint.id, {}, now))!;
    const page2 = (await getEndpointDetail(db, endpoint.id, { checkPage: "999999" }, now))!;
    expect(page1.checks.items[0].id).toBe(`${prefix}check-25`);
    expect(page2.checks).toMatchObject({ page: 2, pages: 2 });
    expect(page2.checks.items[0].id).toBe(`${prefix}check-00`);
    expect(new Set([...page1.checks.items, ...page2.checks.items].map(check => check.id)).size).toBe(26);
    expect((await getEndpointDetail(db, endpoint.id, { checkPage: "-10" }, now))!.checks.page).toBe(1);
  });
  it("paginates all-time incidents without losing the independent active incident", async () => {
    const endpoint = await create("incidents");
    for (let index = 27; index > 0; index--) {
      await persistCheckResult(db, endpoint.id, outcome(index * 120_000, "FAILURE"));
      await persistCheckResult(db, endpoint.id, outcome(index * 120_000 - 60_000));
    }
    await persistCheckResult(db, endpoint.id, outcome(1000, "FAILURE"));
    const data = (await getEndpointDetail(db, endpoint.id, { incidentPage: "2" }, now))!;
    expect(data.incidents).toMatchObject({ total: 28, page: 2, pages: 2 });
    expect(data.incidents.items).toHaveLength(3);
    expect(data.incidents.items.every(item => item.status === "RESOLVED" && item.durationMs === 60_000)).toBe(true);
    expect(data.activeIncident!.status).toBe("OPEN");
  });
  it("uses checkedAt instead of insert order for current health and chart order", async () => {
    const endpoint = await create("late");
    await db.checkResult.create({ data: { endpointId: endpoint.id, ...outcome(1000) } });
    await db.checkResult.create({ data: { endpointId: endpoint.id, ...outcome(2000, "FAILURE", 250) } });
    const data = (await getEndpointDetail(db, endpoint.id, {}, now))!;
    expect(data.health).toBe("UP");
    expect(data.chartChecks.map(check => check.status)).toEqual(["SUCCESS", "FAILURE"]);
  });
  it("returns not found and omits private ownership/connection fields", async () => {
    expect(await getEndpointDetail(db, `${prefix}missing`, {}, now)).toBeNull();
    const endpoint = await create("projection", { checkClaimToken: "private-token", checkClaimExpiresAt: new Date(now.getTime() + 300_000) });
    const data = (await getEndpointDetail(db, endpoint.id, {}, now))!;
    expect(data.endpoint).not.toHaveProperty("checkClaimToken");
    expect(JSON.stringify(data)).not.toContain("private-token");
  });
});
