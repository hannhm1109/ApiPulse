import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { persistCheckResult } from "../../server/monitoring/persist-check-result";
import type { CheckOutcome } from "../../server/monitoring/types";

describe("incident lifecycle in PostgreSQL", () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error("Set TEST_DATABASE_URL to run database tests.");
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: 5, connectionTimeoutMillis: 5000 }),
  });
  const endpointId = `test-incidents-${randomUUID()}`;
  const start = new Date("2026-10-08T13:00:00Z");
  const atMinute = (minute: number) => new Date(start.getTime() + minute * 60_000);
  const outcome = (status: CheckOutcome["status"], minute: number): CheckOutcome => ({
    status,
    checkedAt: atMinute(minute),
    responseTimeMs: status === "TIMEOUT" ? 5000 : 120,
    statusCode: status === "SUCCESS" ? 200 : status === "FAILURE" ? 503 : null,
    failureReason: status === "SUCCESS" ? null : status === "TIMEOUT"
      ? "Request timed out after 5000 ms" : "Unexpected HTTP status: 503 (expected 200)",
  });
  const save = (status: CheckOutcome["status"], minute: number) =>
    persistCheckResult(db, endpointId, outcome(status, minute));
  const incidents = () => db.incident.findMany({ where: { endpointId }, orderBy: { startedAt: "asc" } });

  beforeAll(async () => {
    await db.endpoint.create({ data: { id: endpointId, name: "Incident fixture", url: "https://example.com/health" } });
  });

  beforeEach(async () => {
    await db.incident.deleteMany({ where: { endpointId } });
    await db.checkResult.deleteMany({ where: { endpointId } });
    await db.endpoint.update({ where: { id: endpointId }, data: { lastCheckedAt: null } });
  });

  afterAll(async () => {
    try {
      await db.endpoint.deleteMany({ where: { id: endpointId } });
    } finally {
      await db.$disconnect();
    }
  });

  it("healthy then healthy creates no incident", async () => {
    await save("SUCCESS", 0);
    await save("SUCCESS", 1);
    expect(await incidents()).toHaveLength(0);
  });

  it.each(["FAILURE", "TIMEOUT"] as const)("healthy then %s opens one incident", async status => {
    await save("SUCCESS", 0);
    const failed = await save(status, 1);
    expect(await incidents()).toEqual([expect.objectContaining({
      status: "OPEN", startedAt: atMinute(1), firstFailedCheckId: failed.id,
      cause: failed.failureReason, resolvedAt: null, recoveryCheckId: null,
    })]);
  });

  it("repeated failures and timeouts preserve the original unhealthy period", async () => {
    await save("FAILURE", 0);
    const [original] = await incidents();
    await save("FAILURE", 1);
    await save("TIMEOUT", 2);
    expect(await incidents()).toEqual([original]);
    expect(await db.checkResult.count({ where: { endpointId } })).toBe(3);
  });

  it("success resolves the incident using the recovery observation", async () => {
    const failed = await save("FAILURE", 0);
    const recovery = await save("SUCCESS", 9);
    const [resolved] = await incidents();
    expect(resolved).toMatchObject({
      status: "RESOLVED", startedAt: atMinute(0), firstFailedCheckId: failed.id,
      resolvedAt: atMinute(9), recoveryCheckId: recovery.id, cause: failed.failureReason,
    });
    await save("SUCCESS", 10);
    expect(await incidents()).toEqual([resolved]);
  });

  it("a new failure after recovery opens a separate incident", async () => {
    await save("FAILURE", 0);
    await save("SUCCESS", 1);
    const [resolved] = await incidents();
    const nextFailure = await save("TIMEOUT", 2);
    const history = await incidents();
    expect(history).toHaveLength(2);
    expect(history[0]).toEqual(resolved);
    expect(history[1]).toMatchObject({
      status: "OPEN", startedAt: atMinute(2), firstFailedCheckId: nextFailure.id,
      resolvedAt: null, recoveryCheckId: null,
    });
    expect(history[1].id).not.toBe(resolved.id);
  });

  it("concurrent failed checks commit successfully with only one open incident", async () => {
    const checks = await Promise.all([save("FAILURE", 0), save("FAILURE", 1)]);
    const history = await incidents();
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("OPEN");
    expect(checks.map(check => check.id)).toContain(history[0].firstFailedCheckId);
    expect(await db.checkResult.count({ where: { endpointId } })).toBe(2);
    expect((await db.endpoint.findUniqueOrThrow({ where: { id: endpointId } })).lastCheckedAt).toEqual(atMinute(1));
  });

  it("late older failure stays in history without reopening a recovered endpoint", async () => {
    await save("FAILURE", 0);
    await save("SUCCESS", 3);
    const [resolved] = await incidents();
    await save("FAILURE", 1);
    expect(await incidents()).toEqual([resolved]);
    expect(await db.checkResult.count({ where: { endpointId } })).toBe(3);
    expect((await db.endpoint.findUniqueOrThrow({ where: { id: endpointId } })).lastCheckedAt).toEqual(atMinute(3));
  });

  it("late older success cannot resolve a newer failure", async () => {
    await save("FAILURE", 3);
    const [open] = await incidents();
    await save("SUCCESS", 1);
    expect(await incidents()).toEqual([open]);
  });

  it("checks with equal timestamps use their serialized persistence order", async () => {
    await save("FAILURE", 0);
    const recovery = await save("SUCCESS", 0);
    expect(await incidents()).toEqual([expect.objectContaining({
      status: "RESOLVED", resolvedAt: atMinute(0), recoveryCheckId: recovery.id,
    })]);
  });

  it("uses a fallback cause if a failed observation has no reason", async () => {
    await persistCheckResult(db, endpointId, { ...outcome("FAILURE", 0), failureReason: null });
    expect((await incidents())[0].cause).toBe("Health check failed");
  });

  it("database uniqueness rejects a second open incident", async () => {
    const failed = await save("FAILURE", 0);
    await expect(db.incident.create({ data: {
      endpointId, startedAt: failed.checkedAt, cause: "Duplicate fixture", firstFailedCheckId: failed.id,
    } })).rejects.toMatchObject({ code: "P2002" });
    expect(await incidents()).toHaveLength(1);
  });

  it("database rejects a resolved incident without recovery fields", async () => {
    await save("FAILURE", 0);
    const [open] = await incidents();
    await expect(db.incident.update({ where: { id: open.id }, data: { status: "RESOLVED" } }))
      .rejects.toThrow("Incident_resolution_state_check");
    expect(await incidents()).toEqual([open]);
  });

  it("database rejects a recovery timestamp preceding the incident", async () => {
    await save("FAILURE", 3);
    const recovery = await save("SUCCESS", 1);
    const [open] = await incidents();
    await expect(db.incident.update({ where: { id: open.id }, data: {
      status: "RESOLVED", resolvedAt: atMinute(1), recoveryCheckId: recovery.id,
    } })).rejects.toThrow("Incident_resolution_state_check");
    expect(await incidents()).toEqual([open]);
  });
});
