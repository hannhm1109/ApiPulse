import "dotenv/config";
import { CheckStatus, IncidentStatus } from "../generated/prisma/enums";
import { createPrismaClient } from "../server/db/client";

const prisma = createPrismaClient();

async function main() {
  const now = Date.now();
  const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000);

  // Synthetic fixtures: reserved example.com URLs are disabled and never probed.
  await prisma.$transaction(async (tx) => {
    const endpoints = [
      {
        id: "seed-healthy",
        name: "Sample Healthy API",
        url: "https://healthy.example.com/health",
      },
      {
        id: "seed-recovered",
        name: "Sample Recovered API",
        url: "https://recovered.example.com/health",
      },
      {
        id: "seed-down",
        name: "Sample Timeout API",
        url: "https://timeout.example.com/health",
      },
    ];

    for (const endpoint of endpoints) {
      await tx.endpoint.upsert({
        where: { id: endpoint.id },
        update: {},
        create: { ...endpoint, enabled: false, lastCheckedAt: minutesAgo(1) },
      });
    }

    const checks = [
      {
        id: "seed-healthy-success",
        endpointId: "seed-healthy",
        checkedAt: minutesAgo(1),
        responseTimeMs: 120,
        statusCode: 200,
        status: CheckStatus.SUCCESS,
        failureReason: null,
      },
      {
        id: "seed-recovered-failure",
        endpointId: "seed-recovered",
        checkedAt: minutesAgo(10),
        responseTimeMs: 85,
        statusCode: 503,
        status: CheckStatus.FAILURE,
        failureReason: "Unexpected HTTP status: 503 (expected 200)",
      },
      {
        id: "seed-recovered-success",
        endpointId: "seed-recovered",
        checkedAt: minutesAgo(1),
        responseTimeMs: 150,
        statusCode: 200,
        status: CheckStatus.SUCCESS,
        failureReason: null,
      },
      {
        id: "seed-down-timeout",
        endpointId: "seed-down",
        checkedAt: minutesAgo(1),
        responseTimeMs: 5000,
        statusCode: null,
        status: CheckStatus.TIMEOUT,
        failureReason: "Request timed out after 5000 ms",
      },
    ];

    for (const check of checks) {
      await tx.checkResult.upsert({ where: { id: check.id }, update: {}, create: check });
    }

    await tx.incident.upsert({
      where: { id: "seed-resolved-incident" },
      update: {},
      create: {
        id: "seed-resolved-incident",
        endpointId: "seed-recovered",
        startedAt: minutesAgo(10),
        resolvedAt: minutesAgo(1),
        status: IncidentStatus.RESOLVED,
        cause: "Unexpected HTTP status: 503 (expected 200)",
        firstFailedCheckId: "seed-recovered-failure",
        recoveryCheckId: "seed-recovered-success",
      },
    });

    await tx.incident.upsert({
      where: { id: "seed-open-incident" },
      update: {},
      create: {
        id: "seed-open-incident",
        endpointId: "seed-down",
        startedAt: minutesAgo(1),
        status: IncidentStatus.OPEN,
        cause: "Request timed out after 5000 ms",
        firstFailedCheckId: "seed-down-timeout",
      },
    });
  });

  console.info("Seed complete: 3 sample endpoints, 4 synthetic checks, 2 sample incidents.");
}

main()
  .catch((error: unknown) => {
    console.error("Database seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
