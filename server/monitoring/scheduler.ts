import "server-only";
import type { PrismaClient } from "../../generated/prisma/client";
import { CheckClaimLostError, claimDueEndpoints, releaseCheckClaim } from "./check-claims";
import { runClaimedEndpointCheck } from "./run-endpoint-check";
import { SCHEDULER_BATCH_SIZE, SCHEDULER_CONCURRENCY } from "./scheduler-settings";

export type SchedulerSummary = {
  claimed: number;
  success: number;
  failure: number;
  timeout: number;
  skipped: number;
  errors: number;
};

export async function runScheduler(
  db: PrismaClient,
  options: { now?: Date; batchSize?: number; concurrency?: number } = {},
): Promise<SchedulerSummary> {
  const concurrency = options.concurrency ?? SCHEDULER_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > SCHEDULER_CONCURRENCY) {
    throw new RangeError(`Concurrency must be between 1 and ${SCHEDULER_CONCURRENCY}`);
  }
  const endpoints = await claimDueEndpoints(db, options.now ?? new Date(), options.batchSize ?? SCHEDULER_BATCH_SIZE);
  const summary: SchedulerSummary = { claimed: endpoints.length, success: 0, failure: 0, timeout: 0, skipped: 0, errors: 0 };
  console.info(JSON.stringify({ event: "scheduler_started", claimed: endpoints.length }));
  let cursor = 0;

  await Promise.all(Array.from({ length: Math.min(concurrency, endpoints.length) }, async () => {
    while (cursor < endpoints.length) {
      const endpoint = endpoints[cursor++];
      try {
        const check = await runClaimedEndpointCheck(endpoint, db);
        if (check.status === "SUCCESS") summary.success++;
        else if (check.status === "FAILURE") summary.failure++;
        else summary.timeout++;
      } catch (error) {
        let skipped = error instanceof CheckClaimLostError;
        if (!skipped) {
          console.error(JSON.stringify({
            event: "scheduler_endpoint_error", endpointId: endpoint.id,
            error: error instanceof Error ? error.name : "UnknownError",
            detail: error instanceof RangeError ? error.message : undefined,
          }));
        }
        try {
          await releaseCheckClaim(db, endpoint.id, endpoint.checkClaimToken);
        } catch {
          skipped = false;
          console.error(JSON.stringify({ event: "scheduler_claim_release_error", endpointId: endpoint.id }));
        }
        if (skipped) summary.skipped++;
        else summary.errors++;
      }
    }
  }));

  console.info(JSON.stringify({ event: "scheduler_finished", ...summary }));
  return summary;
}
