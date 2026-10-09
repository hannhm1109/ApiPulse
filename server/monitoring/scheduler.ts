import "server-only";
import type { PrismaClient } from "../../generated/prisma/client";
import { CheckClaimLostError, claimDueEndpoints, releaseCheckClaim } from "./check-claims";
import { runClaimedEndpointCheck } from "./run-endpoint-check";
import { SCHEDULER_BATCH_SIZE, SCHEDULER_CONCURRENCY } from "./scheduler-settings";
import { randomUUID } from "node:crypto";
import { logServerError } from "../logging";

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
  const runId = randomUUID();
  const startedAt = performance.now();
  console.info(JSON.stringify({ event: "scheduler_started", runId }));
  let endpoints;
  try {
    endpoints = await claimDueEndpoints(db, options.now ?? new Date(), options.batchSize ?? SCHEDULER_BATCH_SIZE);
  } catch (error) {
    logServerError("scheduler_claim_error", error, { runId });
    throw error;
  }
  const summary: SchedulerSummary = { claimed: endpoints.length, success: 0, failure: 0, timeout: 0, skipped: 0, errors: 0 };
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
          logServerError("scheduler_endpoint_error", error, { endpointId: endpoint.id, runId });
        }
        try {
          await releaseCheckClaim(db, endpoint.id, endpoint.checkClaimToken);
        } catch (error) {
          skipped = false;
          logServerError("scheduler_claim_release_error", error, { endpointId: endpoint.id, runId });
        }
        if (skipped) summary.skipped++;
        else summary.errors++;
      }
    }
  }));

  console.info(JSON.stringify({ event: "scheduler_finished", runId, durationMs: Math.round(performance.now() - startedAt), ...summary }));
  return summary;
}
