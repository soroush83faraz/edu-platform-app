// Sweep orphan upload bytes («یتیم») — files under FILES_DIR that no live `files.file_object` row names, last written
// more than 24 h ago (src/modules/files/sweep.ts; security review 2026-10-19, D6; docs/ops/runbook.md «فایل‌ها»). The
// worker already runs the same bounded sweep hourly for every organization (`files.sweep_orphans`, src/lib/jobs); this
// is the operator's lever after a crash, a restore, or for a whole volume:
//
//   pnpm files:sweep --dry-run                          every organization directory under FILES_DIR, report only
//   pnpm files:sweep --org <organization uuid>          one organization
//   pnpm files:sweep --max-files 100000                 look at more than the default 500 files per organization
//   pnpm files:sweep --force                            delete even when a run looks wrong (most files orphaned) —
//                                                       only after a --dry-run you have checked
//
// Runs as app_rw through the app's own boundary: one `withTenant` transaction per organization, in which
// app.live_file_ids (migration 0025) answers for that organization only. Reads DATABASE_URL and FILES_DIR from ./.env
// like the other scripts. On the server the bytes live in the `app` container's volume: bundle it with
// `pnpm tsx scripts/build-seed-bundles.ts` (build/seed-bundles/sweep-files.mjs) and run it inside that container —
// docs/ops/runbook.md. Prints one JSON line per organization; exits 1 when a lookup failed or a run was braked.
import fs from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

function loadDotEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  try {
    process.loadEnvFile(envPath);
  } catch {
    /* unreadable .env: env.ts reports what is missing */
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Args {
  org?: string;
  maxFiles?: number;
  dryRun: boolean;
  force: boolean;
}

function usage(msg: string): never {
  console.error(`sweep-files: ${msg}\n  [--dry-run] [--org <organization uuid>] [--max-files <n>] [--force]`);
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--force") args.force = true;
    else if (a === "--org") args.org = (argv[++i] ?? "").toLowerCase();
    else if (a === "--max-files") args.maxFiles = Number(argv[++i]);
    else usage(`unknown argument ${a}`);
  }
  if (args.org !== undefined && !UUID_RE.test(args.org)) usage("--org takes an organization id (a UUID)");
  if (args.maxFiles !== undefined && !(Number.isInteger(args.maxFiles) && args.maxFiles > 0 && args.maxFiles <= 1_000_000)) usage("--max-files takes 1 … 1000000");
  return args;
}

async function main(): Promise<boolean> {
  const args = parseArgs(process.argv.slice(2));
  loadDotEnv();
  // Dynamic imports: src/lib/env.ts validates process.env at import time, so .env must be loaded first.
  const { withTenant } = await import("../src/db/client");
  const { filesRoot } = await import("../src/modules/files/storage");
  const { liveFileIds, sweepOrphans } = await import("../src/modules/files/sweep");

  const root = filesRoot();
  const orgs = args.org ? [args.org] : (await readdir(root, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory() && UUID_RE.test(d.name)).map((d) => d.name);
  let clean = true;
  for (const orgId of orgs) {
    const report = await withTenant({ orgId }, (tx) =>
      sweepOrphans({ root, orgId, dryRun: args.dryRun, force: args.force, maxFiles: args.maxFiles, liveIds: (ids) => liveFileIds(tx, ids) }),
    );
    console.log(JSON.stringify(report));
    if (report.lookupFailed || (report.braked && !args.force)) clean = false;
  }
  if (orgs.length === 0) console.log(JSON.stringify({ root, organizations: 0 }));
  return clean;
}

main()
  .then((clean) => process.exit(clean ? 0 : 1))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
