import "dotenv/config";
import { defineConfig } from "vitest/config";
import { requireTestDatabaseUrl } from "./scripts/test-database-url.ts";

requireTestDatabaseUrl();

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/database/**/*.test.ts"],
    fileParallelism: false,
    setupFiles: ["./tests/setup.ts"],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
