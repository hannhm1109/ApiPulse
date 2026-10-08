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
  });

  return new PrismaClient({ adapter });
}
