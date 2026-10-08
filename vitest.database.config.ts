import { defineConfig } from "vitest/config";

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
