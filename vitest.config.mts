import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { BaseSequencer, type TestSpecification } from "vitest/node";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

/**
 * Int files share one database and run sequentially; the default sequencer orders them by cached duration/failures,
 * which changes between runs. Alphabetical order keeps fixture-count assertions deterministic
 * (auth → … → migrate re-seeds → rls*). New files that write fixtures must respect that order.
 */
class AlphabeticalSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return [...files].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
  }
}

export default defineConfig({
  test: {
    // Root-level by necessity (vitest forbids `sequence.sequencer` per project); harmless for the unit project.
    sequence: { sequencer: AlphabeticalSequencer },
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
          globalSetup: ["tests/int/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
