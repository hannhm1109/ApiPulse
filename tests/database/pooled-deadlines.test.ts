import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
import { pgPoolConfig } from "../../server/db/pool-config";

describe("role-level deadlines for pooled connections", () => {
  afterAll(() => { vi.unstubAllEnvs(); });
  it("inherits server deadlines without startup parameters and enforces statement cancellation", async () => {
    const connectionString = process.env.TEST_DATABASE_URL;
    if (!connectionString) throw new Error("Set TEST_DATABASE_URL to run database tests.");
    const admin = new Client({ connectionString, connectionTimeoutMillis: 5000, query_timeout: 15_000 });
    // The identifier contains only a constant prefix and UUID hex; no user input enters SQL identifiers.
    const role = `apipulse_test_${randomUUID().replaceAll("-", "")}`;
    const password = randomUUID();
    let created = false;
    let client: Client | undefined;
    try {
      await admin.connect();
      await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
      created = true;
      await admin.query(`ALTER ROLE ${role} SET statement_timeout = '10s'`);
      await admin.query(`ALTER ROLE ${role} SET lock_timeout = '3s'`);
      await admin.query(`ALTER ROLE ${role} SET idle_in_transaction_session_timeout = '10s'`);
      const url = new URL(connectionString);
      url.username = role;
      url.password = password;
      vi.stubEnv("DATABASE_CONNECTION_MODE", "pooled");
      client = new Client(pgPoolConfig(url.toString()));
      await client.connect();
      const settings = await client.query(`SELECT current_setting('statement_timeout') AS statement,
        current_setting('lock_timeout') AS lock, current_setting('idle_in_transaction_session_timeout') AS idle`);
      expect(settings.rows).toEqual([{ statement: "10s", lock: "3s", idle: "10s" }]);
      await client.query("SET statement_timeout = '50ms'");
      await expect(client.query("SELECT pg_sleep(0.2)")).rejects.toMatchObject({ code: "57014" });
      expect((await client.query("SELECT 1 AS recovered")).rows).toEqual([{ recovered: 1 }]);
    } finally {
      await client?.end();
      try { if (created) await admin.query(`DROP ROLE ${role}`); }
      finally { await admin.end(); }
    }
  });
});
