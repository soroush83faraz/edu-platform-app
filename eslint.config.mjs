import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/** Only these paths may touch the DB access boundary (`src/db/client`). */
const DB_CLIENT_ALLOWED = ["src/lib/actions/**", "src/lib/ctx.ts", "src/lib/jobs/**", "src/db/**", "src/app/api/health/**", "scripts/**", "tests/int/**"];

/**
 * The job runtime (src/lib/jobs: the cross-organization claim, `withTenant` of any job's organization, the system
 * actor) is reachable only from itself, scripts/ (the worker entry) and tests/ — never from request code (src/app,
 * src/modules, src/components, the rest of src/lib). Request code enqueues through src/modules/ops instead.
 */
const JOBS_ALLOWED = ["src/lib/jobs/**", "scripts/**", "tests/**"];

const dbClientPattern = {
  group: ["@/db/client", "**/db/client", "**/db/client.*"],
  message:
    "Import the DB only through defineAction/withTenant (src/lib/actions) or inside src/db and scripts. No raw db access in modules or UI.",
};
const fontPattern = {
  group: ["next/font/google"],
  message: "Google Fonts are blocked in Iran. Use next/font/local (Vazirmatn is self-hosted in the root layout).",
};
const jobsPattern = {
  group: ["@/lib/jobs", "@/lib/jobs/*", "**/lib/jobs/*"],
  message: "The job runtime (src/lib/jobs) runs only in the worker. Enqueue with enqueueJob from @/modules/ops inside your transaction.",
};
const dbClientPatterns = [dbClientPattern, fontPattern];

/**
 * The `cn` package's default tables do not know our @theme tokens (they read `text-row` as a colour and drop it);
 * the configured merger lives in src/lib/cn.ts and is the only one the code may use.
 */
const CN_MESSAGE = 'Import cn from "@/lib/cn" — the package default does not know our @theme tokens (text-row, shadow-1, …).';
const cnPaths = [{ name: "cn", message: CN_MESSAGE }];
const cnPatterns = [{ group: ["cn/*"], message: CN_MESSAGE }];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "react/no-danger": "error",
      "no-restricted-imports": ["error", { paths: cnPaths, patterns: [dbClientPattern, fontPattern, jobsPattern, ...cnPatterns] }],
    },
  },
  {
    files: DB_CLIENT_ALLOWED,
    rules: {
      "no-restricted-imports": ["error", { paths: cnPaths, patterns: [fontPattern, jobsPattern, ...cnPatterns] }],
    },
  },
  {
    files: JOBS_ALLOWED,
    ignores: ["tests/unit/**"],
    rules: {
      "no-restricted-imports": ["error", { paths: cnPaths, patterns: [fontPattern, ...cnPatterns] }],
    },
  },
  {
    // Unit tests may import the job runtime's pure parts (src/lib/jobs/plan.ts), never the DB.
    files: ["tests/unit/**"],
    rules: {
      "no-restricted-imports": ["error", { paths: cnPaths, patterns: [dbClientPattern, fontPattern, ...cnPatterns] }],
    },
  },
  {
    // The one place that builds the configured merger from the package.
    files: ["src/lib/cn.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [...dbClientPatterns, jobsPattern] }] },
  },
  {
    // Plain-Node CommonJS entry points that run inside the standalone image without a build step.
    files: ["scripts/**/*.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // scripts/seed-catalog.js and scripts/worker.mjs are generated at `pnpm build` (gitignored).
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "drizzle/**", "deploy/**", ".claude/**", "backups/**", "template/**", "scripts/seed-catalog.js", "scripts/worker.mjs"]),
]);

export default eslintConfig;
