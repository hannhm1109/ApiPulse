import type { CheckObservation, DashboardData, DashboardSourceEndpoint, HealthState } from "./types";

export const RECENT_CHECK_LIMIT = 12;

export function deriveHealth(
  endpoint: { enabled: boolean; checkIntervalMinutes: number },
  latest: Pick<CheckObservation, "checkedAt" | "status"> | null,
  now: Date,
): HealthState {
  if (!endpoint.enabled) return "DISABLED";
  if (!latest) return "PENDING";
  const age = now.getTime() - latest.checkedAt.getTime();
  if (!Number.isFinite(age) || age < 0 || !Number.isInteger(endpoint.checkIntervalMinutes) || endpoint.checkIntervalMinutes < 1) {
    return "UNKNOWN";
  }
  if (age > endpoint.checkIntervalMinutes * 2 * 60_000) return "STALE";
  return latest.status === "SUCCESS" ? "UP" : "DOWN";
}

export function buildDashboard(rows: DashboardSourceEndpoint[], now: Date): DashboardData {
  const counts: DashboardData["counts"] = { total: rows.length, healthy: 0, down: 0, pending: 0, stale: 0, disabled: 0, unknown: 0, activeIncidents: 0 };
  const incidents: DashboardData["incidents"] = [];
  const endpoints = rows.map(row => {
    // The query returns checks newest first; health and latency must refer to that same observation.
    const latest = row.checkResults[0] ?? null;
    const health = deriveHealth(row, latest, now);
    if (health === "UP") counts.healthy++;
    else if (health === "DOWN") counts.down++;
    else if (health === "PENDING") counts.pending++;
    else if (health === "STALE") counts.stale++;
    else if (health === "DISABLED") counts.disabled++;
    else counts.unknown++;

    incidents.push(...row.incidents.map(incident => ({
      ...incident, startedAt: incident.startedAt.toISOString(),
      endpointId: row.id, endpointName: row.name, enabled: row.enabled,
    })));
    const recentChecks = row.checkResults.slice(0, RECENT_CHECK_LIMIT).map(check => ({ ...check, checkedAt: check.checkedAt.toISOString() }));
    return {
      id: row.id, name: row.name, url: row.url, enabled: row.enabled, health,
      latestCheck: recentChecks[0] ?? null, recentChecks,
      latencyMs: latest?.statusCode != null ? latest.responseTimeMs : null,
    };
  });
  counts.activeIncidents = incidents.length;
  incidents.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
  const priority: Record<HealthState, number> = { DOWN: 0, STALE: 1, UNKNOWN: 2, PENDING: 3, UP: 4, DISABLED: 5 };
  endpoints.sort((a, b) => priority[a.health] - priority[b.health] || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { generatedAt: now.toISOString(), counts, endpoints, incidents };
}
