// local/no-job-runtime — the job runtime (src/lib/jobs: the cross-organization claim, `withTenant` of any job's
// organization, the system actor) is importable ONLY from itself, scripts/ (the worker entry) and tests/ (security
// review 2026-10-20, F6). Unlike `no-restricted-imports`, whose patterns match the specifier TEXT and so missed a
// relative import inside src/lib (`./jobs/runner` from src/lib/x.ts, `../jobs/runner` from src/lib/admin/x.ts), this rule
// RESOLVES the specifier — relative, or the `@/` alias of src/ — and blocks any import, re-export or dynamic import()
// whose target is src/lib/jobs or a file under it. Unit-tested with fixtures in tests/unit/eslint-no-job-runtime.test.ts.
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root: this file lives in <root>/eslint-rules/. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Is `p` the directory `dir` or inside it? */
function within(p, dir) {
  const rel = path.relative(dir, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** @type {import("eslint").Rule.RuleModule} */
export const noJobRuntime = {
  meta: {
    type: "problem",
    docs: { description: "Only src/lib/jobs, scripts/ and tests/ may import the job runtime (src/lib/jobs)." },
    schema: [{ type: "object", properties: { root: { type: "string" } }, additionalProperties: false }],
    messages: {
      blocked: "The job runtime (src/lib/jobs) runs only in the worker. Enqueue with enqueueJob from @/modules/ops inside your transaction.",
    },
  },
  create(context) {
    const root = context.options[0]?.root ?? ROOT;
    const jobsDir = path.join(root, "src", "lib", "jobs");
    const file = path.resolve(context.filename);
    // The runtime itself, the worker entry and the tests (the unit tests read its pure parts).
    if ([jobsDir, path.join(root, "scripts"), path.join(root, "tests")].some((dir) => within(file, dir))) return {};

    /** @param {import("estree").Node} node @param {unknown} spec */
    function check(node, spec) {
      if (typeof spec !== "string") return;
      let target;
      if (spec === "@" || spec.startsWith("@/")) target = path.join(root, "src", spec.slice(2));
      else if (spec.startsWith(".")) target = path.resolve(path.dirname(file), spec);
      else return;
      if (within(target, jobsDir)) context.report({ node, messageId: "blocked" });
    }
    return {
      ImportDeclaration: (node) => check(node, node.source.value),
      ExportNamedDeclaration: (node) => node.source && check(node, node.source.value),
      ExportAllDeclaration: (node) => check(node, node.source.value),
      ImportExpression: (node) => node.source.type === "Literal" && check(node, node.source.value),
    };
  },
};

/** The `local` plugin of eslint.config.mjs. */
const localRules = { rules: { "no-job-runtime": noJobRuntime } };
export default localRules;
