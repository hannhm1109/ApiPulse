import "server-only";
import type { PrismaClient } from "../../generated/prisma/client";
import { endpointIdSchema } from "../endpoints/validation";
import { deriveHealth } from "../dashboard/health-summary";
import type { CheckObservation } from "../dashboard/types";
import type { DetailIncident, EndpointDetailData, HistoryQuery } from "./types";
import { HISTORY_PAGE_SIZE, LATENCY_CHART_LIMIT, historyPagination, historyWindowStart, incidentDuration, parseHistoryOptions, responseLatency, summarizeChecks } from "./history-metrics";

const checkSelect = { id: true, checkedAt: true, status: true, statusCode: true, responseTimeMs: true, failureReason: true } as const;
const checkOrder = [{ checkedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }] as const;
const incidentSelect = { id: true, status: true, cause: true, startedAt: true, resolvedAt: true } as const;
const serializeCheck = (check: CheckObservation) => ({ ...check, checkedAt: check.checkedAt.toISOString() });

export async function getEndpointDetail(db: PrismaClient, id: string, query: HistoryQuery = {}, now?: Date): Promise<EndpointDetailData | null> {
  if (!endpointIdSchema.safeParse(id).success) return null;
  const options = parseHistoryOptions(query);
  // Counts, aggregates, history, and current state must share the same committed database snapshot.
  return db.$transaction(async tx => {
    const row = await tx.endpoint.findUnique({
      where: { id },
      select: {
        id: true, name: true, url: true, enabled: true, expectedStatusCode: true, timeoutMs: true, checkIntervalMinutes: true,
        checkResults: { take: 1, orderBy: [...checkOrder], select: checkSelect },
        incidents: { where: { status: "OPEN" }, take: 1, select: incidentSelect },
      },
    });
    if (!row) return null;
    // Capture the clock after the initial read so a concurrent committed check is not falsely future-dated.
    const reference = now ?? new Date();
    const windowStart = historyWindowStart(options.period, reference);
    const { checkResults, incidents: openIncidents, ...endpoint } = row;
    const latest = checkResults[0] ?? null;
    const where = { endpointId: id, checkedAt: { gte: windowStart, lte: reference } };
    const counts = await tx.checkResult.groupBy({ by: ["status"], where, _count: { _all: true } });
    const summary = summarizeChecks(counts.map(count => ({ status: count.status, count: count._count._all })));
    const latency = await tx.checkResult.aggregate({
      where: { ...where, statusCode: { not: null }, responseTimeMs: { not: null } },
      _avg: { responseTimeMs: true }, _count: { responseTimeMs: true },
    });
    const checkPaging = historyPagination(summary.total, options.checkPage);
    const incidentPaging = historyPagination(await tx.incident.count({ where: { endpointId: id } }), options.incidentPage);
    const checks = await tx.checkResult.findMany({ where, orderBy: [...checkOrder], skip: checkPaging.skip, take: HISTORY_PAGE_SIZE, select: checkSelect });
    const chartChecks = await tx.checkResult.findMany({ where, orderBy: [...checkOrder], take: LATENCY_CHART_LIMIT, select: checkSelect });
    const incidents = await tx.incident.findMany({ where: { endpointId: id }, orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      skip: incidentPaging.skip, take: HISTORY_PAGE_SIZE, select: incidentSelect });
    const serializeIncident = (incident: typeof incidents[number]): DetailIncident => ({
      ...incident, startedAt: incident.startedAt.toISOString(), resolvedAt: incident.resolvedAt?.toISOString() ?? null,
      durationMs: incidentDuration(incident.startedAt, incident.resolvedAt, reference),
    });
    const checkPage = { total: checkPaging.total, page: checkPaging.page, pages: checkPaging.pages };
    const incidentPage = { total: incidentPaging.total, page: incidentPaging.page, pages: incidentPaging.pages };
    return {
      endpoint, generatedAt: reference.toISOString(), windowStart: windowStart.toISOString(),
      options: { ...options, checkPage: checkPage.page, incidentPage: incidentPage.page },
      health: deriveHealth(endpoint, latest, reference), latestCheck: latest ? serializeCheck(latest) : null,
      latencyMs: latest ? responseLatency(latest) : null,
      metrics: { ...summary, averageLatencyMs: latency._avg.responseTimeMs, responseCount: latency._count.responseTimeMs },
      checks: { ...checkPage, items: checks.map(serializeCheck) }, chartChecks: chartChecks.map(serializeCheck),
      incidents: { ...incidentPage, items: incidents.map(serializeIncident) },
      activeIncident: openIncidents[0] ? serializeIncident(openIncidents[0]) : null,
    };
  }, { isolationLevel: "RepeatableRead" });
}
