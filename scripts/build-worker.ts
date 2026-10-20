// Bundles the background worker (scripts/worker.ts and everything it reaches under src/ — drizzle-orm, zod, uuid, … —
// inlined) into ONE self-contained ESM file, scripts/worker.mjs, that runs inside the standalone image with only the
// packages the image ships (pg, pino, …: scripts/build-seed-bundles.ts `EXTERNAL`). `pnpm build` runs this before
// `next build` (package.json), so the Dockerfile's `COPY /app/scripts ./scripts` ships the file to the `worker`
// compose service (`node scripts/worker.mjs`, deploy/compose.yml); it is gitignored.
//
//   pnpm build:worker       (or: pnpm tsx scripts/build-worker.ts)
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleEntry } from "./build-seed-bundles";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function buildWorker(): ReturnType<typeof bundleEntry> {
  return bundleEntry("scripts/worker.ts", resolve(ROOT, "scripts/worker.mjs"));
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  buildWorker()
    .then((r) => console.log(`worker: wrote ${relative(ROOT, r.out)} (${(r.bytes / 1024).toFixed(0)} KiB; inlined: ${r.packages.join(", ") || "none"})`))
    .catch((err: unknown) => {
      console.error("worker: bundle FAILED:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
