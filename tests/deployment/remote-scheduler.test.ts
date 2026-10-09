import { beforeEach, describe, expect, it, vi } from "vitest";
import { deploymentOrigin, schedulerSummary, triggerScheduler } from "../../scripts/trigger-scheduler.mjs";

describe("remote scheduler client", () => {
  const summary = { claimed: 3, success: 1, failure: 1, timeout: 1, skipped: 0, errors: 0 };
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  it.each(["http://demo.example.com", "https://secret@demo.example.com", "https://demo.example.com/path", "https://demo.example.com?token=secret", "https://demo.example.com:8443"])("refuses unsafe cron destinations", value => {
    expect(() => deploymentOrigin(value)).toThrow("HTTPS origin");
  });
  it("makes one bounded request, does not follow redirects, and treats target failures as normal", async () => {
    fetchMock.mockResolvedValue(Response.json(summary));
    expect(await triggerScheduler("https://demo.example.com", "fixture-secret-long-enough")).toEqual(summary);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("https://demo.example.com/api/cron/checks", expect.objectContaining({
      redirect: "manual", cache: "no-store", signal: expect.any(AbortSignal), headers: { Authorization: "Bearer fixture-secret-long-enough" },
    }));
  });
  it.each([302, 401, 503])("reports HTTP %s without reflecting response details", async status => {
    fetchMock.mockResolvedValue(new Response("secret details", { status }));
    await expect(triggerScheduler("https://demo.example.com", "fixture-secret-long-enough")).rejects.toThrow(`HTTP ${status}`);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("refuses short credentials before any request", async () => {
    await expect(triggerScheduler("https://demo.example.com", "short")).rejects.toThrow("16 characters");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([null, { ...summary, claimed: 4 }, { ...summary, success: -1 }, { ...summary, success: 0.5 }, { ...summary, claimed: 21, success: 19 }])(
    "rejects malformed summaries", value => { expect(() => schedulerSummary(value)).toThrow("invalid summary"); },
  );
});
