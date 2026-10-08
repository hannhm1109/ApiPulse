import "server-only";
import type { Endpoint, PrismaClient } from "../../generated/prisma/client";
import { processIncidentState } from "../incidents/incident-service";
import type { CheckOutcome } from "./types";

export async function persistCheckResult(
  db: PrismaClient,
  endpointId: string,
  outcome: CheckOutcome,
) {
  return db.$transaction(async tx => {
    // Serialize lifecycle writes for this endpoint; HTTP execution has already completed.
    const [endpoint] = await tx.$queryRaw<Pick<Endpoint, "id" | "lastCheckedAt">[]>`
      SELECT "id", "lastCheckedAt" FROM "Endpoint"
      WHERE "id" = ${endpointId} FOR UPDATE
    `;
    if (!endpoint) throw new Error("Endpoint no longer exists");

    const latestCheck = await tx.checkResult.findFirst({
      where: { endpointId },
      orderBy: { checkedAt: "desc" },
      select: { checkedAt: true },
    });
    const result = await tx.checkResult.create({ data: { endpointId, ...outcome } });

    await tx.endpoint.update({
      where: { id: endpointId },
      data: {
        lastCheckedAt: endpoint.lastCheckedAt && endpoint.lastCheckedAt > outcome.checkedAt
          ? endpoint.lastCheckedAt
          : outcome.checkedAt,
      },
    });

    if (!latestCheck || outcome.checkedAt >= latestCheck.checkedAt) {
      await processIncidentState(tx, result);
    }

    return result;
  }, { isolationLevel: "ReadCommitted" });
}
