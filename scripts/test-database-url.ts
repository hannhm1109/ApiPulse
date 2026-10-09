export function requireTestDatabaseUrl(): string {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error("Set TEST_DATABASE_URL to a dedicated test database.");

  function databaseIdentity(value: string) {
    try {
      const url = new URL(value);
      if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.pathname.length < 2) {
        throw new Error();
      }
      return `${url.hostname.toLowerCase()}:${url.port || "5432"}/${decodeURIComponent(url.pathname.slice(1))}`;
    } catch {
      throw new Error("Database test configuration must use a valid PostgreSQL URL with a database name.");
    }
  }

  const testIdentity = databaseIdentity(connectionString);
  if (process.env.DATABASE_URL && testIdentity === databaseIdentity(process.env.DATABASE_URL)) {
    throw new Error("TEST_DATABASE_URL must not point to the DATABASE_URL database.");
  }
  return connectionString;
}
