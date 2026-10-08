import type { CheckStatus } from "../../generated/prisma/enums";

export type HealthState = "UP" | "DOWN" | "PENDING" | "STALE" | "DISABLED" | "UNKNOWN";
export type CheckObservation = {
  id: string;
  checkedAt: Date;
  status: CheckStatus;
  statusCode: number | null;
  responseTimeMs: number | null;
  failureReason: string | null;
};
export type DashboardSourceEndpoint = {
  id: string; name: string; url: string; enabled: boolean; checkIntervalMinutes: number;
  checkResults: CheckObservation[];
  incidents: { id: string; startedAt: Date; cause: string }[];
};
export type DashboardCheck = Omit<CheckObservation, "checkedAt"> & { checkedAt: string };
export type DashboardEndpoint = {
  id: string; name: string; url: string; enabled: boolean; health: HealthState;
  latestCheck: DashboardCheck | null;
  latencyMs: number | null;
  recentChecks: DashboardCheck[];
};
export type DashboardIncident = {
  id: string; endpointId: string; endpointName: string; enabled: boolean;
  startedAt: string; cause: string;
};
export type DashboardData = {
  generatedAt: string;
  counts: { total: number; healthy: number; down: number; pending: number; stale: number; disabled: number; unknown: number; activeIncidents: number };
  endpoints: DashboardEndpoint[];
  incidents: DashboardIncident[];
};
