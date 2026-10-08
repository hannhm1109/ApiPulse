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

    const latestCheck = await tx.checkResult.findFirst({
      where: { endpointId },
      orderBy: { checkedAt: "desc" },
      select: { checkedAt: true },
    });
    const result = await tx.checkResult.create({ data: { endpointId, ...outcome } });

    await tx.endpoint.update({
      where: { id: endpointId },
      data: {
        ...(claimToken !== undefined ? { checkClaimToken: null, checkClaimExpiresAt: null } : {}),
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
