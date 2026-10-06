// Bundles the pilot seeds — scripts/seed-pilot.ts and scripts/seed-demo-extras.ts, with everything they reach under
// src/ and the pure-JS packages (drizzle-orm, uuid, zod, date-fns-jalali, …) — into self-contained ESM files that run
// inside the production image, which has no tsx, no pnpm and no internet. Unlike scripts/build-seed-catalog.ts this
// is NOT part of `pnpm build`: the pilot data is loaded by hand, for a demo, on a server that asks for it.
//
//   pnpm tsx scripts/build-seed-bundles.ts      → build/seed-bundles/{seed-pilot,seed-demo-extras}.mjs (gitignored)
//
// External = what the image's standalone node_modules already ships (pg, @node-rs/argon2 with its native binary,
// pino, next); everything else is inlined. The files resolve those packages from /app/node_modules, so they must be
// mounted UNDER /app (e.g. `-v /srv/school/tools:/app/tools:ro`, then `node /app/tools/seed-pilot.mjs`).
//
// esbuild comes from tsx's own dependency (no new devDependency). Every module but the entry gets its
// `import.meta.url` pinned to its source path, so the `isMain` guards of seed.ts / seed-pilot.ts stay false inside
// the demo-extras bundle and only the entry's main() runs.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "build/seed-bundles");
const ENTRIES = ["scripts/seed-pilot.ts", "scripts/seed-demo-extras.ts"];
/** Packages present in the standalone image (`docker run --rm --entrypoint ls edu-app:<tag> node_modules`). */
const EXTERNAL = ["pg", "@node-rs/argon2", "pino", "next", "next/*"];

/** The slice of esbuild's API used here (esbuild is tsx's dependency, so its typings are not resolvable from the root). */
interface EsbuildPlugin {
  name: string;
  setup(build: { onLoad(opts: { filter: RegExp }, cb: (args: { path: string }) => Promise<{ contents: string; loader: "ts" } | undefined>): void }): void;
}
interface Esbuild {
  build(options: Record<string, unknown> & { plugins: EsbuildPlugin[]; metafile: true }): Promise<{ metafile: { inputs: Record<string, unknown>; outputs: Record<string, { bytes: number }> } }>;
}
const esbuild = createRequire(createRequire(import.meta.url).resolve("tsx/package.json"))("esbuild") as Esbuild;

/** Pins `import.meta.url` of every non-entry TypeScript module to its own source URL. */
function pinImportMeta(entryAbs: string): EsbuildPlugin {
  return {
    name: "pin-import-meta",
    setup(build) {
      build.onLoad({ filter: /\.ts$/ }, async (args) => {
        const source = await readFile(args.path, "utf8");
        if (resolve(args.path) === entryAbs || !source.includes("import.meta.url")) return undefined;
        return { contents: source.replaceAll("import.meta.url", JSON.stringify(pathToFileURL(args.path).href)), loader: "ts" };
      });
    },
  };
}

export async function buildSeedBundles(): Promise<{ out: string; bytes: number; packages: string[] }[]> {
  mkdirSync(OUT_DIR, { recursive: true });
  const results: { out: string; bytes: number; packages: string[] }[] = [];
  for (const entry of ENTRIES) {
    const entryAbs = resolve(ROOT, entry);
    const out = resolve(OUT_DIR, `${entry.replace(/^scripts\//, "").replace(/\.ts$/, "")}.mjs`);
    const result = await esbuild.build({
      entryPoints: [entryAbs],
      outfile: out,
      bundle: true,
      platform: "node",
      target: "node22",
      format: "esm",
      external: EXTERNAL,
      tsconfig: resolve(ROOT, "tsconfig.json"),
      metafile: true,
      logLevel: "warning",
      legalComments: "none",
      // Inlined CommonJS packages may `require` Node built-ins; ESM output has no `require` of its own.
      banner: { js: `// Generated from ${entry} by scripts/build-seed-bundles.ts — do not edit.\nimport { createRequire as __seedCreateRequire } from "node:module";\nconst require = __seedCreateRequire(import.meta.url);` },
      plugins: [pinImportMeta(entryAbs)],
    });
    const packages = new Set<string>();
    for (const input of Object.keys(result.metafile.inputs)) {
      const m = /node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(input);
      if (m?.[1]) packages.add(m[1].replace("\\", "/"));
    }
    results.push({ out, bytes: result.metafile.outputs[relative(ROOT, out).split("\\").join("/")]?.bytes ?? 0, packages: [...packages].sort() });
  }
  return results;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  buildSeedBundles()
    .then((results) => {
      for (const r of results) console.log(`seed-bundles: wrote ${relative(ROOT, r.out)} (${(r.bytes / 1024).toFixed(0)} KiB; inlined: ${r.packages.join(", ") || "none"})`);
    })
    .catch((err: unknown) => {
      console.error("seed-bundles: FAILED:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
