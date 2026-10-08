import "server-only";
import type { PrismaClient } from "../../generated/prisma/client";
import type { CheckOutcome } from "./types";

export async function persistCheckResult(
  db: PrismaClient,
  endpointId: string,
  outcome: CheckOutcome,
) {
  const [result] = await db.$transaction([
    db.checkResult.create({ data: { endpointId, ...outcome } }),
    db.endpoint.update({
      where: { id: endpointId },
      data: { lastCheckedAt: outcome.checkedAt },
    }),
  ]);

  return result;
}
