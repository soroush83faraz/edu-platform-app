// `pnpm check:forbidden` (part of `pnpm verify`): plain-text guard for constructs ESLint cannot see, because they
// live inside sql`...` template strings or plain SQL strings.
//
//   set_config(  — binds RLS context (app.current_org_id / app.current_person_id / app.current_user_account_id).
//                 Only src/db/client.ts may call it (withTenant / bindAccountContext, always is_local = true).
//                 A stray `set_config(..., false)` on a pooled connection would leak one request's tenant into the
//                 next; a stray `set_config('app.current_org_id', <input>, true)` would let a caller pick its tenant.
//                 Allowed outside application code: scripts/ (seed/migrate run as app_owner), tests/, drizzle/.
//
// Plain Node, no dependencies (runs before install-heavy tooling and inside CI without a build).
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

/** Directories never scanned (relative to the repo root). */
const SKIP_DIRS = new Set([".git", ".next", ".claude", "node_modules", "out", "build", "coverage", "public", "scripts", "tests", "drizzle", "deploy", "docs", "backups", "template"]);
/** File extensions that count as application code. */
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);

/** @type {{ name: string; pattern: RegExp; allow: string[]; message: string }[]} */
const RULES = [
  {
    name: "set_config",
    pattern: /set_config\s*\(/,
    allow: ["src/db/client.ts"],
    message: "set_config( may only be called in src/db/client.ts (withTenant / bindAccountContext). Use the wrapper instead.",
  },
];

/** @param {string} dir @param {string[]} out */
function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.relative(ROOT, path.join(dir, entry.name)).split(path.sep).join("/");
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(rel) || SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.isFile() && CODE_EXT.has(path.extname(entry.name))) {
      out.push(rel);
    }
  }
}

function main() {
  /** @type {string[]} */
  const files = [];
  walk(ROOT, files);

  /** @type {string[]} */
  const violations = [];
  for (const rel of files) {
    const lines = fs.readFileSync(path.join(ROOT, rel), "utf8").split(/\r?\n/);
    for (const rule of RULES) {
      if (rule.allow.includes(rel)) continue;
      lines.forEach((line, i) => {
        if (rule.pattern.test(line)) violations.push(`${rel}:${i + 1}: [${rule.name}] ${rule.message}\n    ${line.trim()}`);
      });
    }
  }

  if (violations.length > 0) {
    console.error(`[check-forbidden] ${violations.length} violation(s):\n` + violations.map((v) => `  ${v}`).join("\n"));
    process.exit(1);
  }
  console.log(`[check-forbidden] ok (${files.length} files, ${RULES.length} rule(s))`);
}

main();
