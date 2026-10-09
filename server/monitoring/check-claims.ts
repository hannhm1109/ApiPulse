import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma, type Endpoint, type PrismaClient } from "../../generated/prisma/client";
import { CHECK_CLAIM_DURATION_MS, SCHEDULER_BATCH_SIZE } from "./scheduler-settings";
import { isReadOnlyDeployment } from "../deployment";
import { DEMO_ENDPOINT_IDS } from "../demo/config";

export class CheckClaimLostError extends Error {
  constructor() {
    super("Scheduled check claim is no longer owned or valid");
    this.name = "CheckClaimLostError";
  }
}

export type ClaimedEndpoint = Endpoint & { checkClaimToken: string; checkClaimExpiresAt: Date };

export async function claimDueEndpoints(
  db: PrismaClient,
  now: Date,
  limit = SCHEDULER_BATCH_SIZE,
): Promise<ClaimedEndpoint[]> {
  if (!Number.isFinite(now.getTime())) throw new RangeError("Claim time must be a valid date");
  if (!Number.isInteger(limit) || limit < 1 || limit > SCHEDULER_BATCH_SIZE) {
    throw new RangeError(`Batch size must be between 1 and ${SCHEDULER_BATCH_SIZE}`);
  }
  const token = randomUUID();
  const expiresAt = new Date(now.getTime() + CHECK_CLAIM_DURATION_MS);
  const scope = isReadOnlyDeployment() ? Prisma.sql`AND "id" IN (${Prisma.join(DEMO_ENDPOINT_IDS)})` : Prisma.empty;

  // Selection and claiming are one statement; competing runs skip rows already locked.
  return db.$queryRaw<ClaimedEndpoint[]>`
    WITH due AS (
      SELECT "id" FROM "Endpoint"
      WHERE "enabled" = true
        ${scope}
        AND ("lastCheckedAt" IS NULL
          OR "lastCheckedAt" + "checkIntervalMinutes" * INTERVAL '1 minute' <= ${now})
        AND ("checkClaimExpiresAt" IS NULL OR "checkClaimExpiresAt" <= ${now})
      ORDER BY "lastCheckedAt" ASC NULLS FIRST, "id" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "Endpoint" AS endpoint
    SET "checkClaimToken" = ${token}, "checkClaimExpiresAt" = ${expiresAt}, "updatedAt" = ${now}
    FROM due WHERE endpoint."id" = due."id"
    RETURNING endpoint.*
  `;
}

export async function releaseCheckClaim(db: PrismaClient, endpointId: string, token: string) {
  await db.endpoint.updateMany({
    where: { id: endpointId, checkClaimToken: token },
    data: { checkClaimToken: null, checkClaimExpiresAt: null },
  });
}
