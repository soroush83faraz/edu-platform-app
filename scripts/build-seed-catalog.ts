// Compiles scripts/seed-catalog.ts and the TypeScript modules it reaches (scripts/catalog.ts, the permission
// catalog under src/) into ONE plain CommonJS file, scripts/seed-catalog.js, that runs inside the standalone image
// with nothing but `pg` and Node's built-ins — the way scripts/migrate.js does, but generated from the TypeScript
// source of truth instead of hand-copied (a copied catalog is exactly what drifted). `pnpm build` runs this before
// `next build` (package.json), so the Dockerfile's `COPY /app/scripts ./scripts` ships the file; it is gitignored.
//
// No bundler dependency: `typescript.transpileModule` (already a devDependency, as scripts/build-sw.ts uses it)
// emits each module as CommonJS, this script walks the relative `require("…")` edges from the entry, and wraps the
// modules in a 12-line registry. Bare imports other than `pg` and `node:*` fail the build — anything else (drizzle,
// zod, …) is not present as a package in the image and would only fail at deploy time.
//
//   pnpm build:seed-catalog       (or: pnpm tsx scripts/build-seed-catalog.ts)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = "scripts/seed-catalog.ts";
const OUT = "scripts/seed-catalog.js";
/** Bare specifiers the image can satisfy: the traced `pg` package and Node's own modules. */
const ALLOWED_BARE = (spec: string) => spec === "pg" || spec.startsWith("node:");

interface Emitted {
  /** Module id = path relative to the repo root, forward slashes, no extension (`scripts/catalog`). */
  id: string;
  js: string;
}

const toId = (abs: string): string => relative(ROOT, abs).split("\\").join("/").replace(/\.ts$/, "");

/** Resolves a relative specifier from `fromAbs` to an existing `.ts` file (or `<dir>/index.ts`). */
function resolveRelative(fromAbs: string, spec: string): string {
  const base = resolve(dirname(fromAbs), spec);
  for (const candidate of [`${base}.ts`, join(base, "index.ts")]) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      /* try the next shape */
    }
  }
  throw new Error(`build-seed-catalog: cannot resolve "${spec}" from ${relative(ROOT, fromAbs)}`);
}

function transpile(abs: string): string {
  const { outputText, diagnostics } = ts.transpileModule(readFileSync(abs, "utf8"), {
    fileName: abs,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      isolatedModules: true,
      removeComments: false,
      sourceMap: false,
    },
  });
  if (diagnostics && diagnostics.length > 0) {
    throw new Error(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"));
  }
  return outputText;
}

/** Depth-first from the entry: emit every reachable TypeScript module, rewriting relative requires to module ids. */
function collect(entryAbs: string): Emitted[] {
  const done = new Map<string, Emitted>();
  const visit = (abs: string): void => {
    const id = toId(abs);
    if (done.has(id)) return;
    done.set(id, { id, js: "" }); // reserve (cycles)
    const js = transpile(abs).replace(/require\((["'])([^"']+)\1\)/g, (_m, quote: string, spec: string) => {
      if (spec.startsWith(".")) {
        const target = resolveRelative(abs, spec);
        visit(target);
        return `require(${quote}${toId(target)}${quote})`;
      }
      if (!ALLOWED_BARE(spec)) {
        throw new Error(`build-seed-catalog: ${relative(ROOT, abs)} imports "${spec}", which the standalone image does not ship as a package (only pg and node:* are allowed)`);
      }
      return `require(${quote}${spec}${quote})`;
    });
    done.set(id, { id, js });
  };
  visit(entryAbs);
  return [...done.values()];
}

/** The output file: a tiny CommonJS registry, every module as a function, the entry required last. */
function bundle(modules: Emitted[], entryId: string): string {
  const header = [
    `// Generated from ${ENTRY} by scripts/build-seed-catalog.ts at \`pnpm build\` — do not edit; edit the .ts sources.`,
    `// Runs with \`pg\` and Node built-ins only: node scripts/seed-catalog.js [--test]   (deploy/README.md «سید کاتالوگ»)`,
    `"use strict";`,
    `const __defs = Object.create(null);`,
    `const __cache = Object.create(null);`,
    `function __require(id) {`,
    `  if (!(id in __defs)) return require(id);`,
    `  if (id in __cache) return __cache[id].exports;`,
    `  const module = { exports: {} };`,
    `  __cache[id] = module;`,
    `  __defs[id](module.exports, __require, module);`,
    `  return module.exports;`,
    `}`,
  ];
  const body = modules.map((m) => `__defs[${JSON.stringify(m.id)}] = function (exports, require, module) {\n${m.js}\n};`);
  return `${[...header, ...body, `__require(${JSON.stringify(entryId)});`].join("\n")}\n`;
}

export function buildSeedCatalog(): { out: string; modules: string[] } {
  const entryAbs = resolve(ROOT, ENTRY);
  const modules = collect(entryAbs);
  const out = resolve(ROOT, OUT);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bundle(modules, toId(entryAbs)), "utf8");
  return { out, modules: modules.map((m) => m.id) };
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { out, modules } = buildSeedCatalog();
  console.log(`seed-catalog: wrote ${relative(ROOT, out)} (${modules.length} modules: ${modules.join(", ")})`);
}
