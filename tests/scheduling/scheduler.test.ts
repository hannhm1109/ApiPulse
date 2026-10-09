import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../server/db/prisma";
import { CheckClaimLostError, claimDueEndpoints, releaseCheckClaim, type ClaimedEndpoint } from "../../server/monitoring/check-claims";
import { runClaimedEndpointCheck } from "../../server/monitoring/run-endpoint-check";
import { runScheduler } from "../../server/monitoring/scheduler";

vi.mock("../../server/db/prisma", () => ({ prisma: {} }));
vi.mock("../../server/monitoring/check-claims", async importOriginal => ({
  ...await importOriginal<typeof import("../../server/monitoring/check-claims")>(),
  claimDueEndpoints: vi.fn(), releaseCheckClaim: vi.fn(),
}));
vi.mock("../../server/monitoring/run-endpoint-check", () => ({ runClaimedEndpointCheck: vi.fn() }));

describe("scheduler orchestration", () => {
  const now = new Date();
  const endpoint = (id: string): ClaimedEndpoint => ({
    id, name: id, url: "https://example.com", enabled: true,
    expectedStatusCode: 200, timeoutMs: 5000, checkIntervalMinutes: 5,
    lastCheckedAt: null, checkClaimToken: "test-token",
    checkClaimExpiresAt: new Date(now.getTime() + 300_000), createdAt: now, updatedAt: now,
  });
  const result = (endpointId: string, status: "SUCCESS" | "FAILURE" | "TIMEOUT") => ({
    id: `check-${endpointId}`, endpointId, checkedAt: now, createdAt: now, status,
    responseTimeMs: 100, statusCode: status === "SUCCESS" ? 200 : null,
    failureReason: status === "SUCCESS" ? null : "Fixture failure",
  });

  beforeEach(() => {
    vi.mocked(claimDueEndpoints).mockReset();
    vi.mocked(releaseCheckClaim).mockReset().mockResolvedValue(undefined);
    vi.mocked(runClaimedEndpointCheck).mockReset();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns an empty summary without executing checks when nothing is due", async () => {
    vi.mocked(claimDueEndpoints).mockResolvedValue([]);
    expect(await runScheduler(prisma, { now })).toEqual({ claimed: 0, success: 0, failure: 0, timeout: 0, skipped: 0, errors: 0 });
    expect(runClaimedEndpointCheck).not.toHaveBeenCalled();
    expect(claimDueEndpoints).toHaveBeenCalledWith(prisma, now, 20);
  });

  it("records normal target outcomes and continues after internal failures", async () => {
    vi.mocked(claimDueEndpoints).mockResolvedValue([endpoint("up"), endpoint("bad"), endpoint("slow"), endpoint("internal")]);
    vi.mocked(runClaimedEndpointCheck).mockImplementation(async item => {
      if (item.id === "internal") throw new Error("Database unavailable");
      return result(item.id, item.id === "up" ? "SUCCESS" : item.id === "bad" ? "FAILURE" : "TIMEOUT");
    });
    expect(await runScheduler(prisma)).toEqual({ claimed: 4, success: 1, failure: 1, timeout: 1, skipped: 0, errors: 1 });
    expect(runClaimedEndpointCheck).toHaveBeenCalledTimes(4);
    expect(releaseCheckClaim).toHaveBeenCalledExactlyOnceWith(prisma, "internal", "test-token");
  });

  it("bounds concurrency while eventually processing the whole batch", async () => {
    vi.mocked(claimDueEndpoints).mockResolvedValue(Array.from({ length: 7 }, (_, index) => endpoint(String(index))));
    let active = 0;
    let peak = 0;
    vi.mocked(runClaimedEndpointCheck).mockImplementation(async item => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return result(item.id, "SUCCESS");
    });
    expect((await runScheduler(prisma, { concurrency: 2 })).success).toBe(7);
    expect(peak).toBe(2);
    expect(active).toBe(0);
  });

  it("counts lost claims as skipped and releases only the original token", async () => {
    vi.mocked(claimDueEndpoints).mockResolvedValue([endpoint("lost")]);
    vi.mocked(runClaimedEndpointCheck).mockRejectedValue(new CheckClaimLostError());
    expect(await runScheduler(prisma)).toMatchObject({ skipped: 1, errors: 0 });
    expect(releaseCheckClaim).toHaveBeenCalledWith(prisma, "lost", "test-token");
  });

  it("reports cleanup failures without stopping the remaining work", async () => {
    vi.mocked(claimDueEndpoints).mockResolvedValue([endpoint("lost"), endpoint("up")]);
    vi.mocked(runClaimedEndpointCheck).mockImplementation(async item => {
      if (item.id === "lost") throw new CheckClaimLostError();
      return result(item.id, "SUCCESS");
    });
    vi.mocked(releaseCheckClaim).mockRejectedValue(new Error("Database unavailable"));
    expect(await runScheduler(prisma)).toMatchObject({ success: 1, skipped: 0, errors: 1 });
  });

  it("propagates selection failure without pretending checks ran", async () => {
    const error = new Error("Claim query failed");
    vi.mocked(claimDueEndpoints).mockRejectedValue(error);
    await expect(runScheduler(prisma)).rejects.toBe(error);
    expect(runClaimedEndpointCheck).not.toHaveBeenCalled();
  });

  it("rejects unbounded concurrency", async () => {
    await expect(runScheduler(prisma, { concurrency: 6 })).rejects.toThrow(RangeError);
    expect(claimDueEndpoints).not.toHaveBeenCalled();
  });
  it("correlates a run's logs and counts every claimed endpoint exactly once", async () => {
    vi.mocked(claimDueEndpoints).mockResolvedValue([endpoint("up"), endpoint("internal")]);
    vi.mocked(runClaimedEndpointCheck).mockImplementation(async item => {
      if (item.id === "internal") throw new Error("postgresql://user:secret@internal");
      return result(item.id, "SUCCESS");
    });
    const summary = await runScheduler(prisma);
    expect(summary.claimed).toBe(summary.success + summary.failure + summary.timeout + summary.skipped + summary.errors);
    const info = vi.mocked(console.info).mock.calls.map(([entry]) => JSON.parse(entry));
    const errors = vi.mocked(console.error).mock.calls.map(([entry]) => JSON.parse(entry));
    expect(info[0]).toMatchObject({ event: "scheduler_started", runId: expect.any(String) });
    expect(info[1]).toMatchObject({ event: "scheduler_finished", runId: info[0].runId, durationMs: expect.any(Number) });
    expect(errors[0].runId).toBe(info[0].runId);
    expect(JSON.stringify(errors)).not.toContain("secret");
  });
});
