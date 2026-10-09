import type { PoolConfig } from "pg";

export function pgPoolConfig(connectionString: string): PoolConfig {
  const mode = process.env.DATABASE_CONNECTION_MODE ?? "direct";
  if (mode !== "direct" && mode !== "pooled") throw new Error("DATABASE_CONNECTION_MODE must be direct or pooled.");
  return {
    connectionString, max: 5, connectionTimeoutMillis: 5000,
    application_name: "api-pulse",
    // Transaction poolers must inherit these deadlines from the database role, not startup/session parameters.
    ...(mode === "direct" ? {
      statement_timeout: 10_000, lock_timeout: 3000, idle_in_transaction_session_timeout: 10_000,
    } : { query_timeout: 10_000 }),
  };
}
