import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { getEndpoint, listEndpoints, saveEndpoint, setEndpointEnabled } from "../../server/endpoints/endpoint-service";
import { claimDueEndpoints } from "../../server/monitoring/check-claims";
import { persistCheckResult } from "../../server/monitoring/persist-check-result";

describe("endpoint management in PostgreSQL", () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error("Set TEST_DATABASE_URL to run database tests.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 5, connectionTimeoutMillis: 5000 }) });
  const prefix = `test-management-${randomUUID()}-`;
  const ids = new Set<string>();
  const config = { name: "Payments", url: "https://api.example.com/health", enabled: false, expectedStatusCode: 200, timeoutMs: 5000, checkIntervalMinutes: 5 };
  const create = async (suffix: string, fields = {}) => {
    const row = await db.endpoint.create({ data: { id: `${prefix}${suffix}`, ...config, ...fields } });
    ids.add(row.id); return row;
  };
  const cleanup = () => db.endpoint.deleteMany({ where: { id: { in: [...ids] } } });
  const success = () => ({ checkedAt: new Date(), responseTimeMs: 100, statusCode: 200, status: "SUCCESS" as const, failureReason: null });

  beforeAll(async () => {
    if (await db.endpoint.count({ where: { enabled: true } })) {
      throw new Error("Management scheduling tests need a dedicated database with no unrelated enabled endpoints.");
    }
  });
  beforeEach(cleanup);
  afterAll(async () => { try { await cleanup(); } finally { await db.$disconnect(); } });

  it("creates valid configuration without accepting injected state", async () => {
    const result = await saveEndpoint(db, { ...config, name: "  Payments  ", lastCheckedAt: new Date(), checkClaimToken: "injected" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected creation");
    ids.add(result.id);
    expect(await db.endpoint.findUniqueOrThrow({ where: { id: result.id } })).toMatchObject({ ...config, lastCheckedAt: null, checkClaimToken: null });
  });
  it("invalid input produces field errors without inserting rows", async () => {
    const count = await db.endpoint.count();
    expect(await saveEndpoint(db, { ...config, timeoutMs: 30001 })).toMatchObject({ ok: false, errors: { timeoutMs: expect.any(Array) } });
    expect(await db.endpoint.count()).toBe(count);
  });
  it("edits configuration while preserving check and incident history", async () => {
    const endpoint = await create("history");
    const failed = await persistCheckResult(db, endpoint.id, { ...success(), status: "FAILURE", failureReason: "HTTP 503" });
    expect(await saveEndpoint(db, { ...config, name: "Updated", url: "https://example.com/new", expectedStatusCode: 204, timeoutMs: 3000, checkIntervalMinutes: 10 }, endpoint.id)).toEqual({ ok: true, id: endpoint.id });
    const current = await db.endpoint.findUniqueOrThrow({ where: { id: endpoint.id }, include: { checkResults: true, incidents: true } });
    expect(current).toMatchObject({ name: "Updated", url: "https://example.com/new", expectedStatusCode: 204, timeoutMs: 3000, checkIntervalMinutes: 10, lastCheckedAt: failed.checkedAt });
    expect(current.checkResults).toHaveLength(1);
    expect(current.incidents).toHaveLength(1);
    expect(current.incidents[0].status).toBe("OPEN");
  });
  it("configuration edits fence a claimed check before it can persist", async () => {
    await create("claimed", { enabled: true });
    const claimed = (await claimDueEndpoints(db, new Date())).find(row => row.id === `${prefix}claimed`)!;
    expect(claimed).toBeDefined();
    await saveEndpoint(db, { ...config, enabled: true, url: "https://example.com/new" }, claimed.id);
    await expect(persistCheckResult(db, claimed.id, success(), claimed.checkClaimToken)).rejects.toThrow("claim");
    expect(await db.checkResult.count({ where: { endpointId: claimed.id } })).toBe(0);
  });
  it("disable then re-enable cannot revive an old claim", async () => {
    const endpoint = await create("disable", { enabled: true, checkClaimToken: "old-token", checkClaimExpiresAt: new Date(Date.now() + 300000) });
    await setEndpointEnabled(db, endpoint.id, false);
    await setEndpointEnabled(db, endpoint.id, true);
    await expect(persistCheckResult(db, endpoint.id, success(), "old-token")).rejects.toThrow("claim");
    expect(await db.endpoint.findUniqueOrThrow({ where: { id: endpoint.id } })).toMatchObject({ enabled: true, checkClaimToken: null, checkClaimExpiresAt: null });
  });
  it("explicit enable is idempotent and does not erase an existing active claim", async () => {
    const endpoint = await create("enable", { checkClaimToken: "current", checkClaimExpiresAt: new Date(Date.now() + 300000) });
    await setEndpointEnabled(db, endpoint.id, true);
    await setEndpointEnabled(db, endpoint.id, true);
    expect(await db.endpoint.findUniqueOrThrow({ where: { id: endpoint.id } })).toMatchObject({ enabled: true, checkClaimToken: "current" });
  });
  it("disabled never-checked endpoints are not due", async () => {
    const endpoint = await create("excluded");
    expect((await claimDueEndpoints(db, new Date())).some(row => row.id === endpoint.id)).toBe(false);
  });
  it("handles missing or invalid identifiers and malformed boolean values", async () => {
    expect(await getEndpoint(db, "missing")).toBeNull();
    expect(await getEndpoint(db, "../invalid")).toBeNull();
    expect(await saveEndpoint(db, config, `${prefix}missing`)).toMatchObject({ ok: false });
    expect(await setEndpointEnabled(db, `${prefix}missing`, true)).toMatchObject({ ok: false });
    expect(await setEndpointEnabled(db, {}, true)).toMatchObject({ ok: false });
    expect(await setEndpointEnabled(db, "valid-id", "false")).toMatchObject({ ok: false });
  });
  it("list and edit reads expose configuration only, never ownership tokens", async () => {
    const endpoint = await create("projection", { checkClaimToken: "private", checkClaimExpiresAt: new Date() });
    const listed = (await listEndpoints(db)).find(row => row.id === endpoint.id)!;
    expect(listed).toEqual({ id: endpoint.id, ...config });
    expect(await getEndpoint(db, endpoint.id)).toEqual(listed);
  });
});
