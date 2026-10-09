import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { DEMO_ENDPOINT_IDS } from "../../server/demo/config";
import { seedDemoEndpoints } from "../../server/demo/seed-demo";
import { getEndpoint, listEndpoints, saveEndpoint, setEndpointEnabled } from "../../server/endpoints/endpoint-service";
import { getDashboard } from "../../server/dashboard/dashboard-service";
import { getEndpointDetail } from "../../server/endpoint-detail/detail-service";
import { claimDueEndpoints } from "../../server/monitoring/check-claims";
import { persistCheckResult } from "../../server/monitoring/persist-check-result";

describe("public demo boundaries in PostgreSQL", () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error("Set TEST_DATABASE_URL to run database tests.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 3, connectionTimeoutMillis: 5000 }) });
  const privateId = `test-demo-private-${randomUUID()}`;
  const ownRows = { id: { in: [...DEMO_ENDPOINT_IDS, privateId] } };
  let ownsFixtures = false;
  beforeAll(async () => {
    if (await db.endpoint.count()) throw new Error("Demo tests require an empty dedicated database; do not seed it.");
    ownsFixtures = true;
  });
  beforeEach(async () => {
    await db.endpoint.deleteMany({ where: ownRows });
    vi.stubEnv("APIPULSE_MODE", "demo");
    vi.stubEnv("DEMO_BASE_URL", "https://demo.example.com");
    await seedDemoEndpoints(db);
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => {
    try { if (ownsFixtures) await db.endpoint.deleteMany({ where: ownRows }); }
    finally { await db.$disconnect(); }
  });
  const privateEndpoint = () => db.endpoint.create({ data: {
    id: privateId, name: "Private record", url: "https://private.example.com/health", enabled: true,
  } });

  it("seeds only enabled configuration, without synthetic checks or incidents", async () => {
    expect(await db.endpoint.count()).toBe(3);
    expect(await db.checkResult.count()).toBe(0);
    expect(await db.incident.count()).toBe(0);
    for (const endpoint of await db.endpoint.findMany()) {
      expect(endpoint).toMatchObject({ enabled: true, timeoutMs: 5000, checkIntervalMinutes: 5, lastCheckedAt: null });
      expect(endpoint.url).toBe(`https://demo.example.com/api/demo/${endpoint.id.slice(5)}`);
    }
  });

  it("rerunning setup preserves observed history and last check, while fencing old claims", async () => {
    const checkedAt = new Date(Date.now() - 1000);
    await persistCheckResult(db, "demo-healthy", {
      checkedAt, status: "SUCCESS", statusCode: 200, responseTimeMs: 42, failureReason: null,
    });
    await db.endpoint.update({ where: { id: "demo-healthy" }, data: {
      checkClaimToken: "old-setup-claim", checkClaimExpiresAt: new Date(Date.now() + 60_000),
    } });
    await seedDemoEndpoints(db);
    expect(await db.endpoint.count()).toBe(3);
    expect(await db.checkResult.count()).toBe(1);
    expect(await db.endpoint.findUnique({ where: { id: "demo-healthy" } })).toMatchObject({
      lastCheckedAt: checkedAt, checkClaimToken: null, checkClaimExpiresAt: null,
    });
  });

  it("refuses a database containing unrelated endpoints without changing any rows", async () => {
    await privateEndpoint();
    const before = await db.endpoint.findMany({ orderBy: { id: "asc" } });
    await expect(seedDemoEndpoints(db)).rejects.toThrow("dedicated database");
    expect(await db.endpoint.findMany({ orderBy: { id: "asc" } })).toEqual(before);
  });

  it("filters foreign records from public lists, dashboard, configuration and detail", async () => {
    await privateEndpoint();
    expect((await listEndpoints(db)).map(row => row.id).sort()).toEqual([...DEMO_ENDPOINT_IDS].sort());
    expect((await getDashboard(db)).endpoints.map(row => row.id).sort()).toEqual([...DEMO_ENDPOINT_IDS].sort());
    expect(await getEndpoint(db, privateId)).toBeNull();
    expect(await getEndpointDetail(db, privateId)).toBeNull();
    expect(await getEndpoint(db, "demo-healthy")).not.toBeNull();
    expect(await getEndpointDetail(db, "demo-healthy")).not.toBeNull();
  });

  it("claims only the three public IDs, leaving unrelated due rows entirely unchanged", async () => {
    const privateRow = await privateEndpoint();
    expect((await claimDueEndpoints(db, new Date())).map(row => row.id).sort()).toEqual([...DEMO_ENDPOINT_IDS].sort());
    expect(await db.endpoint.findUnique({ where: { id: privateId } })).toEqual(privateRow);
  });

  it("rejects management mutations without updating configuration or claims", async () => {
    const before = await db.endpoint.findUniqueOrThrow({ where: { id: "demo-healthy" } });
    expect(await setEndpointEnabled(db, before.id, false)).toMatchObject({ ok: false });
    expect(await saveEndpoint(db, { ...before, name: "Tampered" }, before.id)).toMatchObject({ ok: false });
    expect(await saveEndpoint(db, { ...before, name: "Unexpected new endpoint" })).toMatchObject({ ok: false });
    expect(await db.endpoint.findUnique({ where: { id: before.id } })).toEqual(before);
    expect(await db.endpoint.count()).toBe(3);
  });
});
