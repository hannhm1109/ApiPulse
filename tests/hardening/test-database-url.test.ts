import { afterEach, describe, expect, it, vi } from "vitest";
import { requireTestDatabaseUrl } from "../../scripts/test-database-url";

describe("dedicated test database guard", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts a separate database on the same server", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@localhost:5432/apipulse");
    vi.stubEnv("TEST_DATABASE_URL", "postgresql://user:password@localhost:5432/apipulse_test");
    expect(requireTestDatabaseUrl()).toBe(process.env.TEST_DATABASE_URL);
  });

  it.each([
    "postgres://another:credential@LOCALHOST/apipulse?sslmode=require",
    "postgresql://user:password@localhost:5432/%61pipulse",
  ])("ignores credentials, protocol aliases, encoding and options when detecting the same database", value => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@localhost:5432/apipulse");
    vi.stubEnv("TEST_DATABASE_URL", value);
    expect(requireTestDatabaseUrl).toThrow("must not point");
  });

  it.each(["", "not-a-url", "https://private:secret@localhost/database", "postgresql://localhost", "postgresql://localhost/%zz"])(
    "rejects invalid configuration without including its value", value => {
      vi.stubEnv("DATABASE_URL", "");
      vi.stubEnv("TEST_DATABASE_URL", value);
      expect(requireTestDatabaseUrl).toThrow(/dedicated test database|valid PostgreSQL URL/);
      try { requireTestDatabaseUrl(); } catch (error) {
        expect(String(error)).not.toContain("private:secret");
      }
    },
  );
});
