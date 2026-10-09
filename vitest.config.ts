import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/monitoring/**/*.test.ts", "tests/incidents/**/*.test.ts", "tests/scheduling/**/*.test.ts", "tests/endpoints/**/*.test.ts", "tests/dashboard/**/*.test.ts", "tests/endpoint-detail/**/*.test.ts", "tests/hardening/**/*.test.ts", "tests/deployment/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
