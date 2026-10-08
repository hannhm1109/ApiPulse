import type { DashboardCheck } from "../dashboard/types";
import type { HistoryOptions, HistoryPeriod, HistoryQuery, StatusCount } from "./types";

export const HISTORY_PAGE_SIZE = 25;
export const LATENCY_CHART_LIMIT = 200;
export const periodLabels: Record<HistoryPeriod, string> = { "24h": "24 hours", "7d": "7 days", "30d": "30 days" };
const periodHours: Record<HistoryPeriod, number> = { "24h": 24, "7d": 168, "30d": 720 };

export function parseHistoryOptions(query: HistoryQuery): HistoryOptions {
  const page = (value: string | string[] | undefined) => {
    if (typeof value !== "string" || !/^[1-9]\d{0,5}$/.test(value)) return 1;
    return Math.min(Number(value), 10_000);
  };
  const period = typeof query.period === "string" && Object.hasOwn(periodHours, query.period) ? query.period as HistoryPeriod : "7d";
  return { period, checkPage: page(query.checkPage), incidentPage: page(query.incidentPage) };
}

export function historyWindowStart(period: HistoryPeriod, now: Date): Date {
  return new Date(now.getTime() - periodHours[period] * 3_600_000);
}

export function calculateUptime(successful: number, total: number): number | null {
  if (!Number.isInteger(successful) || !Number.isInteger(total) || total <= 0 || successful < 0 || successful > total) return null;
  return successful / total * 100;
}

export function summarizeChecks(counts: StatusCount[]) {
  const count = (status: StatusCount["status"]) => counts.find(row => row.status === status)?.count ?? 0;
  const successful = count("SUCCESS"), failed = count("FAILURE"), timedOut = count("TIMEOUT");
  const total = successful + failed + timedOut;
  return { total, successful, failed, timedOut, uptimePercent: calculateUptime(successful, total) };
}

export function historyPagination(total: number, requestedPage: number) {
  const pages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
  const page = Math.max(1, Math.min(requestedPage, pages));
  return { total, page, pages, skip: (page - 1) * HISTORY_PAGE_SIZE };
}

export function incidentDuration(startedAt: Date, resolvedAt: Date | null, now: Date): number | null {
  const duration = (resolvedAt ?? now).getTime() - startedAt.getTime();
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

export function responseLatency(check: Pick<DashboardCheck, "statusCode" | "responseTimeMs">): number | null {
  return check.statusCode != null ? check.responseTimeMs : null;
}

export function latencySeries(checksNewestFirst: DashboardCheck[]): [number[], (number | null)[]] {
  // uPlot needs unique ascending timestamps. At ties, retain the query's deterministic newest observation.
  const seen = new Set<number>();
  const unique = checksNewestFirst.filter(check => {
    const timestamp = Date.parse(check.checkedAt);
    if (seen.has(timestamp)) return false;
    seen.add(timestamp);
    return true;
  }).toReversed();
  return [unique.map(check => Date.parse(check.checkedAt) / 1000), unique.map(responseLatency)];
}

export function detailHref(id: string, options: HistoryOptions, section?: "checks" | "incidents") {
  const query = new URLSearchParams({ period: options.period });
  if (options.checkPage > 1) query.set("checkPage", String(options.checkPage));
  if (options.incidentPage > 1) query.set("incidentPage", String(options.incidentPage));
  return `/endpoints/${encodeURIComponent(id)}?${query}${section ? `#${section}` : ""}`;
}
