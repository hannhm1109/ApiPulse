import "dotenv/config";
import { createPrismaClient } from "../server/db/client";
import { seedDemoEndpoints } from "../server/demo/seed-demo";
import { productionDatabaseUrl } from "./production-database-url";
import { logServerError } from "../server/logging";

async function main() {
  // Setup uses the direct connection and never falls back to the local DATABASE_URL.
  process.env.DATABASE_URL = productionDatabaseUrl();
  process.env.DATABASE_CONNECTION_MODE = "direct";
  const db = createPrismaClient();
  try {
    const ids = await seedDemoEndpoints(db);
    console.info(JSON.stringify({ event: "demo_setup_finished", endpoints: ids.length, syntheticChecks: 0 }));
  } finally {
    await db.$disconnect();
  }
}

main().catch(error => { logServerError("demo_setup_error", error); process.exitCode = 1; });
