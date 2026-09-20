import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/shared/**/*.ts"],
      thresholds: {
        lines: 90,
        functions: 85,
        branches: 80,
        statements: 85,
      },
    },
  },
});
