import "server-only";
import type { Endpoint, PrismaClient } from "../../generated/prisma/client";
import { executeHttpCheck } from "./execute-http-check";
import { persistCheckResult } from "./persist-check-result";

export async function runEndpointCheck(endpoint: Endpoint, db: PrismaClient) {
  const outcome = await executeHttpCheck(endpoint);
  return persistCheckResult(db, endpoint.id, outcome);
}
