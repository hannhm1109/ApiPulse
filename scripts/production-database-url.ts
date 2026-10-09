export function productionDatabaseUrl(): string {
  try {
    const url = new URL(process.env.DIRECT_URL ?? "");
    if (!["postgresql:", "postgres:"].includes(url.protocol) || !url.hostname ||
      url.hostname === "localhost" || url.hostname.endsWith(".localhost") ||
      url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.pathname.length < 2 ||
      url.hostname.includes("-pooler.") ||
      url.searchParams.get("sslmode") !== "verify-full") throw new Error();
    return url.toString();
  } catch {
    throw new Error("Production commands require DIRECT_URL for a dedicated managed database with sslmode=verify-full.");
  }
}
