import "dotenv/config";
import { defineConfig } from "prisma/config";
import { requireTestDatabaseUrl } from "./scripts/test-database-url.ts";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: requireTestDatabaseUrl() },
});
