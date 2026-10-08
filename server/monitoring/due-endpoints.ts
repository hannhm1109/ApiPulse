import type { Endpoint } from "../../generated/prisma/client";

export function isEndpointDue(
  endpoint: Pick<Endpoint, "enabled" | "lastCheckedAt" | "checkIntervalMinutes">,
  now: Date,
): boolean {
  if (!endpoint.enabled) return false;
  if (!Number.isInteger(endpoint.checkIntervalMinutes) || endpoint.checkIntervalMinutes < 1) {
    throw new RangeError("checkIntervalMinutes must be a positive integer");
  }
  return endpoint.lastCheckedAt === null ||
    endpoint.lastCheckedAt.getTime() + endpoint.checkIntervalMinutes * 60_000 <= now.getTime();
}
