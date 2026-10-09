import "dotenv/config";
import { defineConfig } from "prisma/config";
import { productionDatabaseUrl } from "./scripts/production-database-url.ts";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: productionDatabaseUrl() },
});
