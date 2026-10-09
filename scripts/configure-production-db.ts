import "dotenv/config";
import { Client } from "pg";
import { productionDatabaseUrl } from "./production-database-url";

async function main() {
  const db = new Client({ connectionString: productionDatabaseUrl(), connectionTimeoutMillis: 5000, query_timeout: 10_000 });
  try {
    await db.connect();
    await db.query("BEGIN");
    await db.query("ALTER ROLE CURRENT_USER SET statement_timeout = '10s'");
    await db.query("ALTER ROLE CURRENT_USER SET lock_timeout = '3s'");
    await db.query("ALTER ROLE CURRENT_USER SET idle_in_transaction_session_timeout = '10s'");
    await db.query("COMMIT");
    console.info("Production database role deadlines configured. Reconnect pooled clients before verifying health.");
  } finally {
    await db.end();
  }
}

main().catch(() => {
  console.error("Production database configuration failed. Verify the direct URL, TLS and role permissions.");
  process.exitCode = 1;
});
