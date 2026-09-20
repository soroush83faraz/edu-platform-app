// Emits the service worker into public/ as two ES modules (no bundler: `@serwist/next`'s webpack plugin cannot run
// under Turbopack, which is Next 16's default bundler, and its configurator needs a package we do not have).
// `pnpm build` runs this first; the files are gitignored build outputs.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const root = join(import.meta.dirname, "..");
const out = join(root, "public");
mkdirSync(out, { recursive: true });

function emit(src: string, dest: string, rewrite: (js: string) => string = (s) => s): void {
  const source = readFileSync(join(root, src), "utf8");
  const { outputText, diagnostics } = ts.transpileModule(source, {
    fileName: src,
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2020, removeComments: false, verbatimModuleSyntax: true },
  });
  if (diagnostics && diagnostics.length > 0) {
    for (const d of diagnostics) console.error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    process.exit(1);
  }
  const banner = `// Generated from ${src} by scripts/build-sw.ts — do not edit.\n`;
  writeFileSync(join(out, dest), banner + rewrite(outputText), "utf8");
  console.log(`sw: wrote public/${dest}`);
}

emit("src/lib/pwa/should-cache.ts", "sw-routing.js");
emit("src/lib/pwa/sw.ts", "sw.js", (js) => js.replace(/from\s+"\.\/should-cache(?:\.js)?"/, 'from "./sw-routing.js"'));
