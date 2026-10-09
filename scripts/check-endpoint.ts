import "dotenv/config";
import { createPrismaClient } from "../server/db/client";
import { runEndpointCheck } from "../server/monitoring/run-endpoint-check";
import { logServerError } from "../server/logging";

async function main() {
  const [endpointId, ...extra] = process.argv.slice(2);
  if (!endpointId || extra.length) {
    throw new Error("Usage: npm run check:endpoint -- <endpoint-id>");
  }

  const db = createPrismaClient();
  try {
    const endpoint = await db.endpoint.findUnique({ where: { id: endpointId } });
    if (!endpoint) throw new Error("Endpoint was not found");
    if (!endpoint.enabled) throw new Error("Endpoint is disabled");
    const result = await runEndpointCheck(endpoint, db);
    console.info(JSON.stringify(result, null, 2));
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  logServerError("manual_check_error", error);
  process.exitCode = 1;
});
