import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { CheckClaimLostError, claimDueEndpoints, releaseCheckClaim } from "../../server/monitoring/check-claims";
import { persistCheckResult } from "../../server/monitoring/persist-check-result";
import { runClaimedEndpointCheck } from "../../server/monitoring/run-endpoint-check";
import { runScheduler } from "../../server/monitoring/scheduler";
import * as incidentService from "../../server/incidents/incident-service";

describe("scheduling claims in PostgreSQL", () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error("Set TEST_DATABASE_URL to run database tests.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 5, connectionTimeoutMillis: 5000 }) });
  const prefix = `test-scheduler-${randomUUID()}-`;
  const ownRows = { id: { startsWith: prefix } };
  const create = (suffix: string, fields = {}) => db.endpoint.create({ data: {
    id: `${prefix}${suffix}`, name: suffix, url: "http://127.0.0.1/health", ...fields,
  } });
  const success = () => ({ checkedAt: new Date(), responseTimeMs: 120, statusCode: 200, status: "SUCCESS" as const, failureReason: null });

  beforeAll(async () => {
    if (await db.endpoint.count({ where: { enabled: true } })) {
      throw new Error("Scheduler tests need a dedicated database with no unrelated enabled endpoints.");
    }
  });
  beforeEach(async () => {
    await db.endpoint.deleteMany({ where: ownRows });
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterAll(async () => {
    try { await db.endpoint.deleteMany({ where: ownRows }); }
    finally { await db.$disconnect(); }
  });

  it("selects due, never-checked, and exact-boundary endpoints while excluding disabled and recent ones", async () => {
    const now = new Date();
    await create("never");
    await create("boundary", { lastCheckedAt: new Date(now.getTime() - 5 * 60_000) });
    await create("recent", { lastCheckedAt: new Date(now.getTime() - 5 * 60_000 + 1) });
    await create("disabled", { enabled: false });
    const claimed = await claimDueEndpoints(db, now);
    expect(claimed.map(row => row.name).sort()).toEqual(["boundary", "never"]);
    expect(claimed.every(row => row.checkClaimToken && row.checkClaimExpiresAt > now)).toBe(true);
    expect(claimed.find(row => row.name === "never")?.lastCheckedAt).toBeNull();
  });

  it("overlapping claim queries select disjoint batches", async () => {
    for (let i = 0; i < 6; i++) await create(String(i));
    const [first, second] = await Promise.all([claimDueEndpoints(db, new Date(), 3), claimDueEndpoints(db, new Date(), 3)]);
    expect(first).toHaveLength(3);
    expect(second).toHaveLength(3);
    expect(new Set([...first, ...second].map(row => row.id)).size).toBe(6);
    expect(await claimDueEndpoints(db, new Date())).toHaveLength(0);
  });

  it("caps a batch and prioritizes the least recently checked endpoints", async () => {
    const now = new Date();
    await create("recent-due", { lastCheckedAt: new Date(now.getTime() - 6 * 60_000) });
    await create("old", { lastCheckedAt: new Date(now.getTime() - 20 * 60_000) });
    await create("never");
    expect((await claimDueEndpoints(db, now, 2)).map(row => row.name).sort()).toEqual(["never", "old"]);
    await expect(claimDueEndpoints(db, now, 21)).rejects.toThrow(RangeError);
  });

  it("an expired claim is recoverable and an old owner cannot release or persist over its replacement", async () => {
    await create("recover");
    const [original] = await claimDueEndpoints(db, new Date());
    await db.endpoint.update({ where: { id: original.id }, data: { checkClaimExpiresAt: new Date(Date.now() - 1) } });
    const [replacement] = await claimDueEndpoints(db, new Date());
    expect(replacement.checkClaimToken).not.toBe(original.checkClaimToken);
    await releaseCheckClaim(db, original.id, original.checkClaimToken);
    await expect(persistCheckResult(db, original.id, success(), original.checkClaimToken)).rejects.toBeInstanceOf(CheckClaimLostError);
    expect((await db.endpoint.findUniqueOrThrow({ where: { id: original.id } })).checkClaimToken).toBe(replacement.checkClaimToken);
    expect(await db.checkResult.count({ where: { endpointId: original.id } })).toBe(0);
  });

  it("rejects an invalid claim clock before querying PostgreSQL", async () => {
    const query = vi.spyOn(db, "$queryRaw");
    await expect(claimDueEndpoints(db, new Date(NaN))).rejects.toThrow(RangeError);
    expect(query).not.toHaveBeenCalled();
  });

  it("a scheduled result atomically clears its lease and prevents an immediate duplicate run", async () => {
    await create("record");
    const [claim] = await claimDueEndpoints(db, new Date());
    const result = await persistCheckResult(db, claim.id, success(), claim.checkClaimToken);
    expect(await db.endpoint.findUnique({ where: { id: claim.id } })).toMatchObject({
      checkClaimToken: null, checkClaimExpiresAt: null, lastCheckedAt: result.checkedAt,
    });
    expect(await claimDueEndpoints(db, new Date())).toHaveLength(0);
  });

  it("an expired owner cannot commit even before a replacement claims the endpoint", async () => {
    await create("expired");
    const [claim] = await claimDueEndpoints(db, new Date());
    await db.endpoint.update({ where: { id: claim.id }, data: { checkClaimExpiresAt: new Date(Date.now() - 1) } });
    await expect(persistCheckResult(db, claim.id, success(), claim.checkClaimToken)).rejects.toBeInstanceOf(CheckClaimLostError);
    expect(await db.checkResult.count({ where: { endpointId: claim.id } })).toBe(0);
  });

  it("a disabled queued endpoint is skipped without a result", async () => {
    await create("disabled-later");
    const [claim] = await claimDueEndpoints(db, new Date());
    await db.endpoint.update({ where: { id: claim.id }, data: { enabled: false } });
    await expect(runClaimedEndpointCheck(claim, db)).rejects.toBeInstanceOf(CheckClaimLostError);
    expect(await db.checkResult.count({ where: { endpointId: claim.id } })).toBe(0);
  });

  it("manual persistence does not erase an active scheduler claim", async () => {
    await create("manual");
    const [claim] = await claimDueEndpoints(db, new Date());
    await persistCheckResult(db, claim.id, success());
    expect((await db.endpoint.findUniqueOrThrow({ where: { id: claim.id } })).checkClaimToken).toBe(claim.checkClaimToken);
  });

  it("two real scheduler invocations persist one result per endpoint, including target failures", async () => {
    for (let i = 0; i < 3; i++) await create(String(i));
    const runs = await Promise.all([runScheduler(db, { batchSize: 2 }), runScheduler(db, { batchSize: 2 })]);
    expect(runs.reduce((sum, run) => sum + run.claimed, 0)).toBe(3);
    expect(runs.reduce((sum, run) => sum + run.failure, 0)).toBe(3);
    const endpoints = await db.endpoint.findMany({ where: ownRows, include: { checkResults: true, incidents: true } });
    expect(endpoints.every(row => row.checkResults.length === 1 && row.incidents.length === 1 && row.checkClaimToken === null)).toBe(true);
    expect((await runScheduler(db)).claimed).toBe(0);
  });

  it("internal configuration errors release their claims and do not invent target failures", async () => {
    await create("invalid", { timeoutMs: 30_001 });
    expect(await runScheduler(db)).toMatchObject({ claimed: 1, errors: 1, failure: 0 });
    const row = await db.endpoint.findFirstOrThrow({ where: ownRows });
    expect(row.lastCheckedAt).toBeNull();
    expect(row.checkClaimToken).toBeNull();
    expect(await db.checkResult.count({ where: { endpointId: row.id } })).toBe(0);
    expect((await claimDueEndpoints(db, new Date())).length).toBe(1);
  });

  it("the database rejects an incomplete claim pair", async () => {
    const row = await create("invalid-pair");
    await expect(db.endpoint.update({ where: { id: row.id }, data: { checkClaimToken: "incomplete" } }))
      .rejects.toThrow("Endpoint_check_claim_pair_check");
  });

  it("rolls back a failed claimed transaction, releases that claim, and continues other endpoints", async () => {
    const bad = await create("transaction-error");
    const good = await create("normal-target-failure");
    const processState = incidentService.processIncidentState;
    vi.spyOn(incidentService, "processIncidentState").mockImplementation(async (tx, check) => {
      if (check.endpointId === bad.id) throw new Error("Internal transaction failure");
      await processState(tx, check);
    });
    expect(await runScheduler(db)).toMatchObject({ claimed: 2, failure: 1, errors: 1 });
    expect(await db.endpoint.findUnique({ where: { id: bad.id } })).toMatchObject({
      lastCheckedAt: null, checkClaimToken: null, checkClaimExpiresAt: null,
    });
    expect(await db.checkResult.count({ where: { endpointId: bad.id } })).toBe(0);
    expect(await db.incident.count({ where: { endpointId: bad.id } })).toBe(0);
    expect(await db.checkResult.count({ where: { endpointId: good.id } })).toBe(1);
    expect(await db.incident.count({ where: { endpointId: good.id } })).toBe(1);
  });
});
