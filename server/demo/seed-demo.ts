import "server-only";
import type { PrismaClient } from "../../generated/prisma/client";
import { DEMO_ENDPOINT_IDS, DEMO_KINDS, getDemoOrigin } from "./config";

export async function seedDemoEndpoints(db: PrismaClient) {
  const origin = getDemoOrigin();
  return db.$transaction(async tx => {
    if (await tx.endpoint.count({ where: { id: { notIn: DEMO_ENDPOINT_IDS } } })) {
      throw new Error("Demo setup requires a dedicated database without unrelated endpoints.");
    }
    for (const kind of DEMO_KINDS) {
      const config = {
        name: `Demo ${kind === "healthy" ? "Healthy" : kind === "slow" ? "Slow" : "Recovery"} API`,
        url: `${origin}/api/demo/${kind}`, enabled: true,
        expectedStatusCode: 200, timeoutMs: 5000, checkIntervalMinutes: 5,
      };
      await tx.endpoint.upsert({
        where: { id: `demo-${kind}` },
        create: { id: `demo-${kind}`, ...config },
        update: { ...config, checkClaimToken: null, checkClaimExpiresAt: null },
      });
    }
    return DEMO_ENDPOINT_IDS;
  });
}
