import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "../../server/db/client";
import { persistCheckResult } from "../../server/monitoring/persist-check-result";
import { requireTestDatabaseUrl } from "../../scripts/test-database-url";

describe("production database limits and indexes", () => {
  vi.stubEnv("DATABASE_URL", requireTestDatabaseUrl());
  const db = createPrismaClient();
  vi.unstubAllEnvs();
  const endpointId = `test-hardening-${randomUUID()}`;
  const outcome = { checkedAt: new Date(), status: "FAILURE" as const, responseTimeMs: 10, statusCode: 503, failureReason: "HTTP 503" };

  beforeAll(async () => {
    await db.endpoint.create({ data: { id: endpointId, name: "Hardening fixture", url: "https://example.com", enabled: false } });
  });
  afterAll(async () => {
    try { await db.endpoint.deleteMany({ where: { id: endpointId } }); }
    finally { await db.$disconnect(); }
  });

  it("applies server-side query, lock and idle-transaction deadlines", async () => {
    const [settings] = await db.$queryRaw<Record<string, string>[]>`
      SELECT current_setting('statement_timeout') AS statement,
        current_setting('lock_timeout') AS lock,
        current_setting('idle_in_transaction_session_timeout') AS idle,
        current_setting('application_name') AS application
    `;
    expect(settings).toEqual({ statement: "10s", lock: "3s", idle: "10s", application: "api-pulse" });
  });

  it("bounds row-lock waits, rolls back completely, and remains usable", async () => {
    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const holder = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Endpoint" WHERE "id" = ${endpointId} FOR UPDATE`;
      locked.resolve();
      await release.promise;
    }, { timeout: 20_000 });
    try {
      await Promise.race([locked.promise, holder]);
      await expect(persistCheckResult(db, endpointId, outcome)).rejects.toMatchObject({ code: "P2010" });
      expect(await db.checkResult.count({ where: { endpointId } })).toBe(0);
      expect(await db.incident.count({ where: { endpointId } })).toBe(0);
      expect((await db.endpoint.findUniqueOrThrow({ where: { id: endpointId } })).lastCheckedAt).toBeNull();
    } finally {
      release.resolve();
      await holder;
    }
    await persistCheckResult(db, endpointId, outcome);
    expect(await db.checkResult.count({ where: { endpointId } })).toBe(1);
    expect(await db.incident.count({ where: { endpointId } })).toBe(1);
  }, 20_000);

  it("cancels an overlong query on PostgreSQL and recovers its connection", async () => {
    await expect(db.$queryRaw`SELECT 1 FROM pg_sleep(12)`).rejects.toMatchObject({ code: "P2010" });
    expect(await db.$queryRaw`SELECT 1 AS alive`).toEqual([{ alive: 1 }]);
  }, 20_000);

  it("retains the scheduling, range, incident-history and one-open-incident indexes", async () => {
    const indexes = await db.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'
        AND tablename IN ('Endpoint', 'CheckResult', 'Incident')
    `;
    const byName = new Map(indexes.map(index => [index.indexname, index.indexdef]));
    expect(byName.get("Endpoint_enabled_lastCheckedAt_idx")).toContain('(enabled, "lastCheckedAt")');
    expect(byName.get("CheckResult_endpointId_checkedAt_idx")).toContain('("endpointId", "checkedAt")');
    expect(byName.get("Incident_endpointId_status_idx")).toContain('("endpointId", status)');
    expect(byName.get("Incident_endpointId_startedAt_idx")).toContain('("endpointId", "startedAt")');
    expect(byName.get("Incident_one_open_per_endpoint_idx")).toMatch(/UNIQUE.*WHERE.*OPEN/);
  });
});
