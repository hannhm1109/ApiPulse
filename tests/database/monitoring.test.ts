import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { executeHttpCheck } from "../../server/monitoring/execute-http-check";
import { runEndpointCheck } from "../../server/monitoring/run-endpoint-check";

vi.mock("../../server/monitoring/execute-http-check", () => ({ executeHttpCheck: vi.fn() }));

describe("monitoring persistence in PostgreSQL", () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error("Set TEST_DATABASE_URL to run database tests.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 2, connectionTimeoutMillis: 5000 }) });
  const endpointId = `test-monitoring-${randomUUID()}`;
  const checkedAt = new Date("2026-10-08T12:00:00Z");

  beforeAll(async () => {
    await db.endpoint.create({ data: { id: endpointId, name: "Integration fixture", url: "https://example.com/health" } });
  });

  afterAll(async () => {
    try {
      await db.endpoint.deleteMany({ where: { id: endpointId } });
    } finally {
      await db.$disconnect();
    }
  });

  it.each([
    { status: "SUCCESS", statusCode: 200, failureReason: null },
    { status: "FAILURE", statusCode: 500, failureReason: "Unexpected HTTP status: 500 (expected 200)" },
    { status: "FAILURE", statusCode: null, failureReason: "Network request failed" },
    { status: "TIMEOUT", statusCode: null, failureReason: "Request timed out after 5000 ms" },
  ] as const)("persists $status and advances lastCheckedAt together", async fields => {
    const endpoint = await db.endpoint.findUniqueOrThrow({ where: { id: endpointId } });
    vi.mocked(executeHttpCheck).mockResolvedValue({ checkedAt, responseTimeMs: 123, ...fields });
    const result = await runEndpointCheck(endpoint, db);
    expect(result).toMatchObject({ endpointId, checkedAt, responseTimeMs: 123, ...fields });
    expect(await db.checkResult.findUnique({ where: { id: result.id } })).toEqual(result);
    expect((await db.endpoint.findUniqueOrThrow({ where: { id: endpointId } })).lastCheckedAt).toEqual(checkedAt);
    expect(await db.incident.count({ where: { endpointId } })).toBe(0);
  });

  it("rolls back the result when the endpoint update fails", async () => {
    const endpoint = await db.endpoint.findUniqueOrThrow({ where: { id: endpointId } });
    const before = await db.checkResult.count({ where: { endpointId } });
    vi.mocked(executeHttpCheck).mockResolvedValue({
      checkedAt: new Date("2026-10-08T12:05:00Z"), responseTimeMs: 10,
      status: "SUCCESS", statusCode: 200, failureReason: null,
    });
    const updateEndpoint = db.endpoint.update.bind(db.endpoint);
    vi.spyOn(db.endpoint, "update").mockImplementationOnce(args => updateEndpoint({
      ...args,
      where: { id: `missing-${randomUUID()}` },
    }));
    await expect(runEndpointCheck(endpoint, db)).rejects.toMatchObject({ code: "P2025" });
    expect(await db.checkResult.count({ where: { endpointId } })).toBe(before);
    expect((await db.endpoint.findUniqueOrThrow({ where: { id: endpointId } })).lastCheckedAt).toEqual(checkedAt);
  });

  it("propagates database errors instead of persisting an extra failed observation", async () => {
    const endpoint = await db.endpoint.findUniqueOrThrow({ where: { id: endpointId } });
    const before = await db.checkResult.count({ where: { endpointId } });
    const error = new Error("Database unavailable");
    vi.mocked(executeHttpCheck).mockResolvedValue({
      checkedAt, responseTimeMs: 10, status: "SUCCESS", statusCode: 200, failureReason: null,
    });
    vi.spyOn(db, "$transaction").mockRejectedValueOnce(error);
    await expect(runEndpointCheck(endpoint, db)).rejects.toBe(error);
    expect(await db.checkResult.count({ where: { endpointId } })).toBe(before);
  });

  it("propagates internal execution errors without writing an observation", async () => {
    const endpoint = await db.endpoint.findUniqueOrThrow({ where: { id: endpointId } });
    const before = await db.checkResult.count({ where: { endpointId } });
    const error = new Error("Unexpected internal failure");
    vi.mocked(executeHttpCheck).mockRejectedValue(error);
    await expect(runEndpointCheck(endpoint, db)).rejects.toBe(error);
    expect(await db.checkResult.count({ where: { endpointId } })).toBe(before);
  });
});
