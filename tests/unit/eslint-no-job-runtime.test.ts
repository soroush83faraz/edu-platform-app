// local/no-job-runtime (eslint-rules/no-job-runtime.mjs; security review 2026-10-20, F6): the job runtime in src/lib/jobs
// is reachable only from itself, scripts/ and tests/. The fixtures are file paths + import lines: the specifier patterns
// of `no-restricted-imports` matched only the TEXT (`**/lib/jobs/*`), so `./jobs/runner` from src/lib/x.ts and
// `../jobs/runner` from src/lib/admin/x.ts slipped through; this rule resolves them.
import path from "node:path";
import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import { noJobRuntime } from "../../eslint-rules/no-job-runtime.mjs";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ROOT = path.resolve("/repo");
const at = (rel: string) => path.join(ROOT, ...rel.split("/"));
const options = [{ root: ROOT }];
const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: "module" } });
const blocked = [{ messageId: "blocked" }];

tester.run("local/no-job-runtime", noJobRuntime, {
  valid: [
    // The runtime itself, the worker entry, the tests.
    { code: 'import { claimJobs } from "./runner";', filename: at("src/lib/jobs/worker.ts"), options },
    { code: 'import { runWorker } from "../src/lib/jobs/worker";', filename: at("scripts/worker.ts"), options },
    { code: 'import { claimWants } from "@/lib/jobs/plan";', filename: at("tests/unit/jobs-plan.test.ts"), options },
    { code: 'import { REGISTRY } from "@/lib/jobs/handlers";', filename: at("tests/int/jobs.test.ts"), options },
    // Neighbours that only LOOK alike: src/lib/jobs-help, a package named jobs, the enqueue API of src/modules/ops.
    { code: 'import { x } from "./jobs-help";', filename: at("src/lib/admin/x.ts"), options },
    { code: 'import { x } from "jobs";', filename: at("src/lib/x.ts"), options },
    { code: 'import { enqueueJob } from "@/modules/ops";', filename: at("src/modules/workspace/x.ts"), options },
    { code: 'import { enqueueJob } from "../ops/enqueue";', filename: at("src/modules/workspace/x.ts"), options },
  ],
  invalid: [
    // The gap the review found: relative imports from inside src/lib.
    { code: 'import { claimJobs } from "./jobs/runner";', filename: at("src/lib/x.ts"), options, errors: blocked },
    { code: 'import { claimJobs } from "../jobs/runner";', filename: at("src/lib/admin/x.ts"), options, errors: blocked },
    { code: 'import * as jobs from "./jobs";', filename: at("src/lib/x.ts"), options, errors: blocked },
    // The alias and the long relative forms, re-exports and dynamic imports.
    { code: 'import { runJob } from "@/lib/jobs/runner";', filename: at("src/modules/workspace/x.ts"), options, errors: blocked },
    { code: 'import { runJob } from "../../lib/jobs/runner";', filename: at("src/modules/workspace/x.ts"), options, errors: blocked },
    { code: 'export { runJob } from "../jobs/runner";', filename: at("src/lib/admin/x.ts"), options, errors: blocked },
    { code: 'export * from "./jobs/runner";', filename: at("src/lib/x.ts"), options, errors: blocked },
    { code: 'const m = import("../jobs/runner");', filename: at("src/lib/admin/x.ts"), options, errors: blocked },
    { code: 'import { x } from "../../../lib/jobs";', filename: at("src/app/api/x/route.ts"), options, errors: blocked },
  ],
});
