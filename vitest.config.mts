import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globalSetup: ["src/test/globalSetup.ts"],
    setupFiles: ["src/test/setup.mts"],
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
