import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import { getEndpointDetail } from "../../server/endpoint-detail/detail-service";

describe("detail read boundary", () => {
  const findUnique = vi.fn();
  const groupBy = vi.fn();
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    endpoint: { findUnique },
    checkResult: { groupBy, aggregate: vi.fn().mockResolvedValue({ _avg: { responseTimeMs: null }, _count: { responseTimeMs: 0 } }), findMany: vi.fn().mockResolvedValue([]) },
    incident: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
  }));
  const db = { $transaction: transaction } as unknown as PrismaClient;
  beforeEach(() => { vi.clearAllMocks(); findUnique.mockResolvedValue(null); groupBy.mockResolvedValue([]); });

  it("returns not found for invalid IDs without querying PostgreSQL", async () => {
    expect(await getEndpointDetail(db, "../bad")).toBeNull();
    expect(transaction).not.toHaveBeenCalled();
  });
  it("loads the read model within a repeatable-read transaction", async () => {
    expect(await getEndpointDetail(db, "missing")).toBeNull();
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead" });
    const select = findUnique.mock.calls[0][0].select;
    expect(select.checkResults.take).toBe(1);
    expect(select.checkResults.orderBy).toEqual([{ checkedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }]);
    expect(select).not.toHaveProperty("checkClaimToken");
    expect(select.incidents.where).toEqual({ status: "OPEN" });
  });
  it("propagates database errors, not false healthy/empty data", async () => {
    findUnique.mockRejectedValue(new Error("Database unavailable"));
    await expect(getEndpointDetail(db, "endpoint")).rejects.toThrow("Database unavailable");
  });
  it("captures the snapshot clock after the initial read, avoiding false future health", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-08T16:00:00Z"));
      findUnique.mockImplementationOnce(async () => {
        vi.setSystemTime(new Date("2026-10-08T16:00:02Z"));
        return { id: "endpoint", name: "Payments", url: "https://example.com", enabled: true, expectedStatusCode: 200, timeoutMs: 5000, checkIntervalMinutes: 5,
          checkResults: [{ id: "check", checkedAt: new Date("2026-10-08T16:00:01Z"), status: "SUCCESS", statusCode: 200, responseTimeMs: 0, failureReason: null }], incidents: [] };
      });
      const data = (await getEndpointDetail(db, "endpoint"))!;
      expect(data.health).toBe("UP");
      expect(data.generatedAt).toBe("2026-10-08T16:00:02.000Z");
      expect(groupBy.mock.calls[0][0].where.checkedAt.lte.toISOString()).toBe(data.generatedAt);
    } finally { vi.useRealTimers(); }
  });
});
