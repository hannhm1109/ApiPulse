import "server-only";
import type { CheckResult, Prisma } from "../../generated/prisma/client";
import { getIncidentTransition } from "./incident-transition";

// The caller holds the endpoint row lock and passes a check saved in the same transaction.
export async function processIncidentState(tx: Prisma.TransactionClient, check: CheckResult) {
  const openIncident = await tx.incident.findFirst({
    where: { endpointId: check.endpointId, status: "OPEN" },
  });
  const transition = getIncidentTransition(check.status, openIncident !== null);

  if (transition === "OPEN") {
    await tx.incident.create({
      data: {
        endpointId: check.endpointId,
        startedAt: check.checkedAt,
        cause: check.failureReason ?? "Health check failed",
        firstFailedCheckId: check.id,
      },
    });
  } else if (transition === "RESOLVE" && openIncident) {
    await tx.incident.update({
      where: { id: openIncident.id },
      data: {
        status: "RESOLVED",
        resolvedAt: check.checkedAt,
        recoveryCheckId: check.id,
      },
    });
  }
}
