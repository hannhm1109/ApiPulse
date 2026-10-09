import "server-only";
import type { PrismaClient } from "../../generated/prisma/client";
import { buildDashboard, RECENT_CHECK_LIMIT } from "./health-summary";
import { isReadOnlyDeployment } from "../deployment";
import { DEMO_ENDPOINT_IDS } from "../demo/config";

export async function getDashboard(db: PrismaClient, now?: Date) {
  // Prisma may load relations in separate queries; keep counts, checks, and incidents on one snapshot.
  const endpoints = await db.$transaction(tx => tx.endpoint.findMany({
    ...(isReadOnlyDeployment() ? { where: { id: { in: DEMO_ENDPOINT_IDS } } } : {}),
    select: {
      id: true, name: true, url: true, enabled: true, checkIntervalMinutes: true,
      checkResults: {
        orderBy: [{ checkedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        take: RECENT_CHECK_LIMIT,
        select: { id: true, checkedAt: true, status: true, statusCode: true, responseTimeMs: true, failureReason: true },
      },
      incidents: {
        where: { status: "OPEN" },
        select: { id: true, startedAt: true, cause: true },
      },
    },
  }), { isolationLevel: "RepeatableRead" });
  return buildDashboard(endpoints, now ?? new Date());
}
