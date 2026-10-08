import "server-only";
import type { Endpoint, PrismaClient } from "../../generated/prisma/client";
import { executeHttpCheck } from "./execute-http-check";
import { persistCheckResult } from "./persist-check-result";
import { CheckClaimLostError, type ClaimedEndpoint } from "./check-claims";
import { MAX_SCHEDULED_TIMEOUT_MS } from "./scheduler-settings";

export async function runEndpointCheck(endpoint: Endpoint, db: PrismaClient, claimToken?: string) {
  const outcome = await executeHttpCheck(endpoint);
  return persistCheckResult(db, endpoint.id, outcome, claimToken);
}

export async function runClaimedEndpointCheck(endpoint: ClaimedEndpoint, db: PrismaClient) {
  if (!endpoint.checkClaimToken) throw new CheckClaimLostError();
  const current = await db.endpoint.findFirst({
    where: {
      id: endpoint.id, enabled: true, checkClaimToken: endpoint.checkClaimToken,
      checkClaimExpiresAt: { gt: new Date() },
    },
  });
  if (!current) throw new CheckClaimLostError();
  if (current.timeoutMs > MAX_SCHEDULED_TIMEOUT_MS) {
    throw new RangeError(`Scheduled timeoutMs must not exceed ${MAX_SCHEDULED_TIMEOUT_MS}`);
  }
  if (current.checkIntervalMinutes < 1) {
    throw new RangeError("checkIntervalMinutes must be a positive integer");
  }
  return runEndpointCheck(current, db, endpoint.checkClaimToken);
}
