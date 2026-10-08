import { describe, expect, it } from "vitest";
import type { DashboardCheck } from "../../server/dashboard/types";
import { calculateUptime, detailHref, historyPagination, historyWindowStart, incidentDuration, latencySeries, parseHistoryOptions, responseLatency, summarizeChecks } from "../../server/endpoint-detail/history-metrics";
import { utcDateTime } from "../../lib/display-time";

const now = new Date("2026-10-08T16:00:00.000Z");
const check = (age: number, fields: Partial<DashboardCheck> = {}): DashboardCheck => ({ id: String(age), status: "SUCCESS", checkedAt: new Date(now.getTime() - age).toISOString(),
  statusCode: 200, responseTimeMs: 100, failureReason: null, ...fields });

describe("check-based uptime", () => {
  it.each([[4, 4, 100], [0, 4, 0], [3, 4, 75], [1, 3, 100 / 3]])("calculates %i successful / %i completed checks", (successful, total, expected) => {
    expect(calculateUptime(successful, total)).toBeCloseTo(expected);
  });
  it.each([[0, 0], [-1, 2], [3, 2], [1, -2], [NaN, 4], [1, Infinity], [0.5, 1]])("does not invent uptime for invalid or empty counts %s/%s", (successful, total) => {
    expect(calculateUptime(successful, total)).toBeNull();
  });
  it("includes failures and timeouts in the denominator", () => {
    expect(summarizeChecks([{ status: "SUCCESS", count: 2 }, { status: "FAILURE", count: 1 }, { status: "TIMEOUT", count: 1 }])).toEqual({ total: 4, successful: 2, failed: 1, timedOut: 1, uptimePercent: 50 });
    expect(summarizeChecks([])).toEqual({ total: 0, successful: 0, failed: 0, timedOut: 0, uptimePercent: null });
  });
});

describe("history windows and controls", () => {
  it.each([["24h", "2026-10-07T16:00:00.000Z"], ["7d", "2026-10-01T16:00:00.000Z"], ["30d", "2026-09-08T16:00:00.000Z"]] as const)("uses a rolling UTC %s window", (period, expected) => {
    expect(historyWindowStart(period, now).toISOString()).toBe(expected);
  });
  it("defaults to 7 days and first pages", () => { expect(parseHistoryOptions({})).toEqual({ period: "7d", checkPage: 1, incidentPage: 1 }); });
  it("accepts known periods and positive whole pages", () => {
    expect(parseHistoryOptions({ period: "24h", checkPage: "3", incidentPage: "2" })).toEqual({ period: "24h", checkPage: 3, incidentPage: 2 });
  });
  it.each(["0", "-2", "1.5", "NaN", "Infinity", "99999999", "1e3", ["2", "3"], undefined])("rejects malformed pages %s", value => {
    expect(parseHistoryOptions({ checkPage: value }).checkPage).toBe(1);
  });
  it.each(["unknown", "__proto__", "constructor", ["7d", "30d"]])("rejects unknown or duplicate periods %s", period => {
    expect(parseHistoryOptions({ period }).period).toBe("7d");
  });
  it("bounds requested offsets and clamps to an actual last page", () => {
    expect(parseHistoryOptions({ checkPage: "999999" }).checkPage).toBe(10_000);
    expect(historyPagination(0, 20)).toEqual({ total: 0, page: 1, pages: 1, skip: 0 });
    expect(historyPagination(26, 20)).toEqual({ total: 26, page: 2, pages: 2, skip: 25 });
    expect(historyPagination(25, 1).pages).toBe(1);
  });
  it("preserves the other history page and period in pagination links", () => {
    expect(detailHref("endpoint", { period: "30d", checkPage: 2, incidentPage: 3 }, "checks")).toBe("/endpoints/endpoint?period=30d&checkPage=2&incidentPage=3#checks");
    expect(detailHref("endpoint", { period: "7d", checkPage: 1, incidentPage: 1 })).toBe("/endpoints/endpoint?period=7d");
  });
});

describe("response history", () => {
  it("keeps real HTTP failure latency and zero milliseconds but never timeout duration", () => {
    expect(responseLatency(check(0, { responseTimeMs: 0 }))).toBe(0);
    expect(responseLatency(check(0, { status: "FAILURE", statusCode: 503, responseTimeMs: 142 }))).toBe(142);
    expect(responseLatency(check(0, { status: "TIMEOUT", statusCode: null, responseTimeMs: 5000 }))).toBeNull();
    expect(responseLatency(check(0, { responseTimeMs: null }))).toBeNull();
  });
  it("uses chronological real timestamps with gaps for nonresponses", () => {
    const series = latencySeries([check(0, { responseTimeMs: 0 }), check(1000, { statusCode: null, responseTimeMs: 5000 }), check(90_000)]);
    expect(series[0]).toEqual([now.getTime() / 1000 - 90, now.getTime() / 1000 - 1, now.getTime() / 1000]);
    expect(series[1]).toEqual([100, null, 0]);
  });
  it("collapses tied timestamps only for plotting, preserving the newest sorted observation", () => {
    const checks = [check(0, { responseTimeMs: 142 }), check(0, { responseTimeMs: 999 }), check(1000)];
    expect(latencySeries(checks)[1]).toEqual([100, 142]);
    expect(checks).toHaveLength(3);
    expect(latencySeries([])).toEqual([[], []]);
  });
  it("formats timestamps explicitly in UTC", () => {
    expect(utcDateTime("2026-10-08T17:00:00+01:00")).toBe("08 Oct 2026, 16:00:00");
  });
});

describe("incident durations", () => {
  it("freezes resolved durations at recovery, not the page read time", () => {
    expect(incidentDuration(new Date(now.getTime() - 90_000), new Date(now.getTime() - 30_000), now)).toBe(60_000);
  });
  it("measures an open duration through the snapshot time", () => { expect(incidentDuration(new Date(now.getTime() - 90_000), null, now)).toBe(90_000); });
  it("preserves a zero duration", () => { expect(incidentDuration(now, now, now)).toBe(0); });
  it("does not emit negative or invalid durations", () => {
    expect(incidentDuration(new Date(now.getTime() + 1000), null, now)).toBeNull();
    expect(incidentDuration(new Date(NaN), null, now)).toBeNull();
  });
});
