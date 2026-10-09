import { afterEach, describe, expect, it, vi } from "vitest";
import { productionDatabaseUrl } from "../../scripts/production-database-url";
import { pgPoolConfig } from "../../server/db/pool-config";

describe("managed database configuration", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("never falls back to the regular local database for production commands", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://apipulse:apipulse@localhost/apipulse");
    vi.stubEnv("DIRECT_URL", "");
    expect(productionDatabaseUrl).toThrow("Production commands require DIRECT_URL");
  });
  it.each(["postgresql://user:secret@localhost/db?sslmode=verify-full", "postgresql://user:secret@host.example.com/db?sslmode=require", "postgresql://user:secret@host-pooler.example.com/db?sslmode=verify-full", "https://user:secret@host.example.com/db", "invalid"])(
    "refuses unsafe production connection configuration", value => {
      vi.stubEnv("DIRECT_URL", value);
      expect(productionDatabaseUrl).toThrow("dedicated managed database");
    },
  );
  it("accepts a direct verified-TLS database URL", () => {
    const url = "postgresql://user:fixture@direct.example.com/db?sslmode=verify-full";
    vi.stubEnv("DIRECT_URL", url);
    expect(productionDatabaseUrl()).toBe(url);
  });
  it("retains server-side startup deadlines on direct connections", () => {
    vi.stubEnv("DATABASE_CONNECTION_MODE", "direct");
    expect(pgPoolConfig("fixture")).toMatchObject({ max: 5, connectionTimeoutMillis: 5000, statement_timeout: 10_000, lock_timeout: 3000, idle_in_transaction_session_timeout: 10_000 });
  });
  it("does not send session/startup deadlines to a transaction pooler", () => {
    vi.stubEnv("DATABASE_CONNECTION_MODE", "pooled");
    const config = pgPoolConfig("fixture");
    expect(config.query_timeout).toBe(10_000);
    expect(config).not.toHaveProperty("statement_timeout");
    expect(config).not.toHaveProperty("lock_timeout");
    expect(config).not.toHaveProperty("idle_in_transaction_session_timeout");
  });
  it("rejects a mistyped connection mode", () => {
    vi.stubEnv("DATABASE_CONNECTION_MODE", "pool");
    expect(() => pgPoolConfig("fixture")).toThrow("direct or pooled");
  });
});
