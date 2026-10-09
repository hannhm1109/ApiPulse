import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

export function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required to connect to PostgreSQL.");
  }

  const adapter = new PrismaPg({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10_000,
    lock_timeout: 3000,
    idle_in_transaction_session_timeout: 10_000,
    application_name: "api-pulse",
  });

  return new PrismaClient({ adapter });
}
