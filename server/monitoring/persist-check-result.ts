import "server-only";
import type { Endpoint, PrismaClient } from "../../generated/prisma/client";
import { processIncidentState } from "../incidents/incident-service";
import type { CheckOutcome } from "./types";
import { CheckClaimLostError } from "./check-claims";

export async function persistCheckResult(
  db: PrismaClient,
  endpointId: string,
  outcome: CheckOutcome,
  claimToken?: string,
) {
  return db.$transaction(async tx => {
    // Serialize lifecycle writes for this endpoint; HTTP execution has already completed.
    const [endpoint] = await tx.$queryRaw<Pick<
      Endpoint, "id" | "enabled" | "lastCheckedAt" | "checkClaimToken" | "checkClaimExpiresAt"
    >[]>`
      SELECT "id", "enabled", "lastCheckedAt", "checkClaimToken", "checkClaimExpiresAt" FROM "Endpoint"
      WHERE "id" = ${endpointId} FOR UPDATE
    `;
    if (!endpoint) throw new Error("Endpoint no longer exists");

    if (claimToken !== undefined && (
      !endpoint.enabled || endpoint.checkClaimToken !== claimToken ||
      !endpoint.checkClaimExpiresAt || endpoint.checkClaimExpiresAt <= new Date()
    )) {
      throw new CheckClaimLostError();
    }

    const result = await tx.checkResult.create({ data: { endpointId, ...outcome } });
    const latestCheck = await tx.checkResult.findFirst({
      where: { endpointId },
      orderBy: [{ checkedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });

    await tx.endpoint.update({
      where: { id: endpointId },
      data: {
        ...(claimToken !== undefined ? { checkClaimToken: null, checkClaimExpiresAt: null } : {}),
        lastCheckedAt: endpoint.lastCheckedAt && endpoint.lastCheckedAt > outcome.checkedAt
          ? endpoint.lastCheckedAt
          : outcome.checkedAt,
      },
    });

    // Use the same tie-breakers as dashboard/detail, even if concurrent transaction clocks finish out of order.
    if (latestCheck?.id === result.id) {
      await processIncidentState(tx, result);
    }

    return result;
  }, { isolationLevel: "ReadCommitted" });
}
