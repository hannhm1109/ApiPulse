import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/monitoring/**/*.test.ts", "tests/incidents/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
