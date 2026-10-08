import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import { getDashboard } from "../../server/dashboard/dashboard-service";

describe("dashboard read boundary", () => {
  const findMany = vi.fn();
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({ endpoint: { findMany } }));
  const db = { $transaction: transaction } as unknown as PrismaClient;

  beforeEach(() => { vi.clearAllMocks(); findMany.mockResolvedValue([]); });

  it("loads endpoint relations within one repeatable-read snapshot", async () => {
    const now = new Date("2026-10-08T16:00:00Z");
    const data = await getDashboard(db, now);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead" });
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(data.generatedAt).toBe(now.toISOString());
  });
  it("selects bounded recent checks and open incidents, with deterministic observation ordering", async () => {
    await getDashboard(db);
    const select = findMany.mock.calls[0][0].select;
    expect(select.checkResults.take).toBe(12);
    expect(select.checkResults.orderBy).toEqual([{ checkedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }]);
    expect(select.incidents.where).toEqual({ status: "OPEN" });
    expect(select).not.toHaveProperty("checkClaimToken");
    expect(select).not.toHaveProperty("lastCheckedAt");
  });
  it("propagates internal database errors instead of inventing an empty healthy dashboard", async () => {
    findMany.mockRejectedValueOnce(new Error("Database unavailable"));
    await expect(getDashboard(db)).rejects.toThrow("Database unavailable");
  });
});
