import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      {
        // Pure unit tests: no DB, no network.
        resolve: { alias },
        test: { name: "unit", environment: "node", include: ["tests/unit/**/*.test.ts", "src/**/*.test.ts"] },
      },
      {
        // Integration tests against the `app_test` database (setup wired in the DB block).
        resolve: { alias },
        test: {
          name: "int",
          environment: "node",
          include: ["tests/int/**/*.test.ts"],
          setupFiles: ["tests/int/setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
