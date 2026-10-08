import type { CheckStatus, IncidentStatus } from "../../generated/prisma/enums";
import type { DashboardCheck, HealthState } from "../dashboard/types";

export type HistoryPeriod = "24h" | "7d" | "30d";
export type HistoryQuery = Record<string, string | string[] | undefined>;
export type HistoryOptions = { period: HistoryPeriod; checkPage: number; incidentPage: number };
export type HistoryPage<T> = { items: T[]; total: number; page: number; pages: number };
export type StatusCount = { status: CheckStatus; count: number };
export type DetailIncident = {
  id: string; status: IncidentStatus; cause: string; startedAt: string; resolvedAt: string | null; durationMs: number | null;
};
export type EndpointDetailData = {
  generatedAt: string; windowStart: string; options: HistoryOptions;
  endpoint: { id: string; name: string; url: string; enabled: boolean; expectedStatusCode: number; timeoutMs: number; checkIntervalMinutes: number };
  health: HealthState; latestCheck: DashboardCheck | null; latencyMs: number | null;
  metrics: { total: number; successful: number; failed: number; timedOut: number; uptimePercent: number | null; averageLatencyMs: number | null; responseCount: number };
  chartChecks: DashboardCheck[];
  checks: HistoryPage<DashboardCheck>; incidents: HistoryPage<DetailIncident>; activeIncident: DetailIncident | null;
};
