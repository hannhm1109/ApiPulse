import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { getDashboard } from "../../server/dashboard/dashboard-service";
import { RECENT_CHECK_LIMIT } from "../../server/dashboard/health-summary";
import { persistCheckResult } from "../../server/monitoring/persist-check-result";
import { setEndpointEnabled } from "../../server/endpoints/endpoint-service";

describe("dashboard observations in PostgreSQL", () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error("Set TEST_DATABASE_URL to run database tests.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 3, connectionTimeoutMillis: 5000 }) });
  const prefix = `test-dashboard-${randomUUID()}-`;
  const now = new Date();
  const ownRows = { id: { startsWith: prefix } };
  const create = (suffix: string, fields = {}) => db.endpoint.create({ data: { id: `${prefix}${suffix}`, name: suffix,
    url: "https://example.com/health", enabled: true, checkIntervalMinutes: 5, ...fields } });
  const outcome = (age: number, status: "SUCCESS" | "FAILURE" | "TIMEOUT" = "SUCCESS") => ({
    checkedAt: new Date(now.getTime() - age), status, statusCode: status === "TIMEOUT" ? null : status === "FAILURE" ? 503 : 200,
    responseTimeMs: status === "TIMEOUT" ? 5000 : 142, failureReason: status === "SUCCESS" ? null : "Fixture failure",
  });
  const endpointFrom = async (id: string) => (await getDashboard(db, now)).endpoints.find(item => item.id === id)!;
  beforeEach(async () => { await db.endpoint.deleteMany({ where: ownRows }); });
  afterAll(async () => { try { await db.endpoint.deleteMany({ where: ownRows }); } finally { await db.$disconnect(); } });

  it("derives health from real observations, not a lastCheckedAt timestamp alone", async () => {
    const endpoint = await create("unobserved", { lastCheckedAt: now });
    expect(await endpointFrom(endpoint.id)).toMatchObject({ health: "PENDING", latestCheck: null, latencyMs: null, recentChecks: [] });
  });
  it("opens, retains, and removes dashboard incidents through the actual persistence lifecycle", async () => {
    const endpoint = await create("lifecycle");
    await persistCheckResult(db, endpoint.id, outcome(90_000, "FAILURE"));
    const first = await getDashboard(db, now);
    expect(first.endpoints.find(item => item.id === endpoint.id)!.health).toBe("DOWN");
    const incident = first.incidents.find(item => item.endpointId === endpoint.id)!;
    await persistCheckResult(db, endpoint.id, outcome(60_000, "TIMEOUT"));
    const repeated = await getDashboard(db, now);
    expect(repeated.incidents.find(item => item.endpointId === endpoint.id)!.id).toBe(incident.id);
    expect(repeated.endpoints.find(item => item.id === endpoint.id)!.latencyMs).toBeNull();
    await persistCheckResult(db, endpoint.id, outcome(30_000));
    const recovered = await getDashboard(db, now);
    expect(recovered.endpoints.find(item => item.id === endpoint.id)!.health).toBe("UP");
    expect(recovered.incidents.some(item => item.endpointId === endpoint.id)).toBe(false);
  });
  it("a historical result inserted late cannot replace a more recent status or latency", async () => {
    const endpoint = await create("late");
    await persistCheckResult(db, endpoint.id, outcome(30_000));
    await persistCheckResult(db, endpoint.id, outcome(60_000, "FAILURE"));
    const data = await endpointFrom(endpoint.id);
    expect(data).toMatchObject({ health: "UP", latencyMs: 142 });
    expect(data.recentChecks.map(check => check.status)).toEqual(["SUCCESS", "FAILURE"]);
  });
  it("limits each endpoint's recent checks independently", async () => {
    const first = await create("history-a");
    const second = await create("history-b");
    for (const endpointId of [first.id, second.id]) {
      await db.checkResult.createMany({ data: Array.from({ length: 20 }, (_, index) => ({ endpointId, ...outcome(index * 1000) })) });
    }
    const data = await getDashboard(db, now);
    expect(data.endpoints.find(item => item.id === first.id)!.recentChecks).toHaveLength(RECENT_CHECK_LIMIT);
    expect(data.endpoints.find(item => item.id === second.id)!.recentChecks).toHaveLength(RECENT_CHECK_LIMIT);
    expect(data.endpoints.find(item => item.id === first.id)!.latestCheck!.checkedAt).toBe(now.toISOString());
  });
  it("disabled endpoints retain observations and open incidents without becoming down", async () => {
    const endpoint = await create("disabled");
    await persistCheckResult(db, endpoint.id, outcome(30_000, "FAILURE"));
    await setEndpointEnabled(db, endpoint.id, false);
    const data = await getDashboard(db, now);
    expect(data.endpoints.find(item => item.id === endpoint.id)).toMatchObject({ health: "DISABLED", latestCheck: { status: "FAILURE" } });
    expect(data.incidents.find(item => item.endpointId === endpoint.id)).toMatchObject({ enabled: false, cause: "Fixture failure" });
  });
  it("stale and future observations do not become current healthy counts", async () => {
    const stale = await create("stale");
    const future = await create("future");
    await db.checkResult.create({ data: { endpointId: stale.id, ...outcome(600_001) } });
    await db.checkResult.create({ data: { endpointId: future.id, ...outcome(-1000) } });
    expect(await endpointFrom(stale.id)).toMatchObject({ health: "STALE" });
    expect(await endpointFrom(future.id)).toMatchObject({ health: "UNKNOWN" });
  });
  it("does not expose claim fields or settings that are unrelated to the dashboard", async () => {
    const endpoint = await create("projection", { checkClaimToken: "private", checkClaimExpiresAt: new Date(Date.now() + 300000) });
    const projected = await endpointFrom(endpoint.id);
    expect(projected).not.toHaveProperty("checkClaimToken");
    expect(projected).not.toHaveProperty("checkClaimExpiresAt");
    expect(projected).not.toHaveProperty("timeoutMs");
  });
});
