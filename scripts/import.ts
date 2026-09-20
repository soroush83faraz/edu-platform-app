// Excel import CLI (developer-run in phase 1; the admin upload UI is week 1).
//
//   pnpm tsx scripts/import.ts <file.xlsx> --org <slug> --school <code> --as <admin phone> [--dry-run]
//   pnpm tsx scripts/import.ts <file.xlsx> --org <slug> --school <code> --as <admin phone> --commit [<batchId>]
//   options: --create-subjects   unknown subjects are created (organization-scoped admin only)
//            IMPORT_PRE_DUMP=0   skip the pg_dump before commit (default on; skipped with a warning when docker fails)
//            IMPORT_DUMP_CMD     override the dump command (default: docker compose -f docker-compose.dev.yml exec -T db pg_dump -Fc -U postgres -d app)
//
// Runs as the application role (DATABASE_URL, app_rw) through `withTenant` with the REAL admin's context
// (`--as` phone → account → membership → assignments), so RLS and the admin scope rule apply exactly as in the UI.
// Dry-run writes integ.import_batch(status=validated) + import_row and prints the summary and the first 30 errors.
// Commit = one transaction (classes → subjects → offerings → staff → teaching → students); the plaintext initial
// passwords of created accounts are written to backups/credentials-<batchId>.csv (UTF-8 BOM) and nowhere else.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function loadDotEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  try {
    process.loadEnvFile(envPath);
  } catch {
    /* reported below when a variable is missing */
  }
}

interface Args {
  file: string;
  org: string;
  school: string;
  as: string;
  mode: "dry-run" | "commit";
  batchId?: string;
  createSubjects: boolean;
}

function usage(msg?: string): never {
  if (msg) console.error(`[import] ${msg}`);
  console.error("usage: tsx scripts/import.ts <file.xlsx> --org <slug> --school <code> --as <admin phone> [--dry-run | --commit [batchId]] [--create-subjects]");
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const file = argv[0];
  if (!file || file.startsWith("--")) usage("file is required");
  const out: Partial<Args> = { file, mode: "dry-run", createSubjects: false };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) usage(`${a} needs a value`);
      return v;
    };
    if (a === "--org") out.org = next();
    else if (a === "--school") out.school = next();
    else if (a === "--as") out.as = next();
    else if (a === "--dry-run") out.mode = "dry-run";
    else if (a === "--commit") {
      out.mode = "commit";
      if (argv[i + 1] && !argv[i + 1].startsWith("--")) out.batchId = argv[++i];
    } else if (a === "--create-subjects") out.createSubjects = true;
    else usage(`unknown option ${a}`);
  }
  if (!out.org || !out.school || !out.as) usage("--org, --school and --as are required");
  return out as Args;
}

const faDigits = (s: string | number) => String(s).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

async function main(): Promise<void> {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  if (!/\.xlsx$/i.test(args.file)) usage("فقط فایل .xlsx پذیرفته می‌شود.");
  const filePath = path.resolve(process.cwd(), args.file);
  if (!fs.existsSync(filePath)) usage(`file not found: ${filePath}`);
  const buffer = fs.readFileSync(filePath);

  // Loaded after .env so src/lib/env.ts sees the variables.
  const { withTenant, withoutTenant } = await import("../src/db/client");
  const { eq } = await import("drizzle-orm");
  const { organization } = await import("../src/modules/tenancy/schema");
  const { findAccountByIdentifier, findActiveMembership, listValidAssignments } = await import("../src/modules/iam/repo");
  const { can } = await import("../src/modules/iam/can");
  const { normalizePhoneIR } = await import("../src/lib/normalize");
  const { parseWorkbook, ImportFileError } = await import("../src/modules/integ/importers/parse");
  const { loadReference, validateImport } = await import("../src/modules/integ/importers/validate");
  const { commitImport, recordBatch, sha256Hex } = await import("../src/modules/integ/importers/commit");
  const { SHEET_BY_KEY } = await import("../src/modules/integ/importers/template");
  const { findSchoolByCode } = await import("../src/modules/tenancy/repo");
  const { getAdminScope } = await import("../src/modules/iam/service");

  // ---- who ----
  const phone = normalizePhoneIR(args.as);
  if (!phone) usage("--as must be an Iranian mobile number");
  const who = await withoutTenant(async (tx) => {
    const [org] = await tx.select({ id: organization.id, name: organization.name }).from(organization).where(eq(organization.slug, args.org)).limit(1);
    if (!org) throw new Error(`organization «${args.org}» not found`);
    const account = await findAccountByIdentifier(tx, phone);
    if (!account || account.status !== "active") throw new Error(`no active account for ${phone}`);
    return { org, account };
  });
  const tenantCtx = await withTenant({ orgId: who.org.id }, async (tx) => {
    const membership = await findActiveMembership(tx, who.account.id);
    if (!membership) throw new Error(`${phone} is not a member of «${args.org}»`);
    const assignments = await listValidAssignments(tx, membership.personId);
    return { personId: membership.personId, assignments };
  });
  const ctx = {
    orgId: who.org.id,
    personId: tenantCtx.personId,
    userId: who.account.id,
    requestId: `import-${Date.now()}`,
    ip: null,
    userAgent: "scripts/import.ts",
    assignments: tenantCtx.assignments,
  };

  // ---- parse + validate ----
  let parsed;
  try {
    parsed = await parseWorkbook(buffer);
  } catch (err) {
    if (err instanceof ImportFileError) {
      console.error(`[import] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
  const fileSha256 = sha256Hex(buffer);
  const { ref, validation } = await withTenant({ orgId: ctx.orgId, personId: ctx.personId }, async (tx) => {
    const sch = await findSchoolByCode(tx, args.school);
    if (!sch) throw new Error(`school «${args.school}» not found in «${args.org}» (or not visible to ${phone})`);
    if (!(await can(tx, ctx, "integ.import.write", { scopeType: "school", id: sch.id }))) throw new Error(`${phone} lacks integ.import.write for school «${args.school}»`);
    if (args.createSubjects && !(await can(tx, ctx, "tenancy.structure.write"))) throw new Error("--create-subjects needs an organization-scoped admin (tenancy.structure.write at organization level)");
    // The reference is read as this admin: existing students matched by number / unique code must be in their scope.
    const ref = await loadReference(tx, await getAdminScope(tx, ctx), args.school, parsed);
    return { ref, validation: validateImport(parsed, ref, { createSubjects: args.createSubjects }) };
  });

  // ---- report ----
  console.log(`\n[import] ${path.basename(filePath)} → ${who.org.name} / ${ref.school.name} (${ref.school.code}) · سال ${ref.academicYear.name} · نوبت ${ref.term.name} · به‌عنوان ${phone}`);
  console.log(`${"شیت".padEnd(16)}${"ردیف".padEnd(8)}${"درست".padEnd(8)}${"هشدار".padEnd(8)}خطا`);
  for (const [k, s] of Object.entries(validation.summary)) {
    console.log(`${SHEET_BY_KEY[k as keyof typeof SHEET_BY_KEY].nameFa.padEnd(16)}${faDigits(s.rows).padEnd(8)}${faDigits(s.ok).padEnd(8)}${faDigits(s.warning).padEnd(8)}${faDigits(s.error)}`);
  }
  const fileIssues = validation.fileErrors.map((e) => `${e.level === "error" ? "خطا" : "هشدار"} · ${e.sheet ? SHEET_BY_KEY[e.sheet].nameFa : "فایل"}${e.rowNumber ? ` ردیف ${faDigits(e.rowNumber)}` : ""}: ${e.message}`);
  const rowIssues = validation.rows
    .filter((r) => r.status === "error")
    .flatMap((r) =>
      r.issues
        .filter((i) => i.level === "error")
        .map((i) => `خطا · ${SHEET_BY_KEY[r.sheet].nameFa} ردیف ${faDigits(r.rowNumber)}${i.column ? ` ستون «${SHEET_BY_KEY[r.sheet].columns.find((c) => c.key === i.column)?.labelFa ?? i.column}»` : ""}: ${i.message}`),
    );
  const issues = [...fileIssues.filter((x) => x.startsWith("خطا")), ...rowIssues, ...fileIssues.filter((x) => x.startsWith("هشدار"))];
  if (issues.length > 0) {
    console.log(`\n${faDigits(Math.min(30, issues.length))} از ${faDigits(issues.length)} مورد:`);
    for (const line of issues.slice(0, 30)) console.log(`  ${line}`);
  }
  console.log(validation.ok ? "\n[import] فایل بدون خطا است." : `\n[import] ${faDigits(validation.errorCount)} خطا — تا رفع خطاها commit ممکن نیست.`);

  if (args.mode === "dry-run") {
    const batchId = await withTenant({ orgId: ctx.orgId, personId: ctx.personId }, (tx) => recordBatch(tx, ctx, ref, validation, { batchId: args.batchId, fileSha256, kind: "full" }, validation.ok ? "validated" : "failed"));
    console.log(`[import] dry-run batch ${batchId} (${validation.ok ? "validated" : "failed"}). برای اعمال: --commit ${batchId}`);
    return;
  }

  if (!validation.ok) process.exit(1);
  preDump(fileSha256.slice(0, 12));
  const result = await withTenant({ orgId: ctx.orgId, personId: ctx.personId }, (tx) => commitImport(tx, ctx, ref, validation, { batchId: args.batchId, fileSha256, kind: "full" }));
  const fmt = (rec: Record<string, number>) => (Object.keys(rec).length ? Object.entries(rec).map(([k, v]) => `${k}=${v}`).join(", ") : "—");
  console.log(`\n[import] committed batch ${result.batchId}`);
  console.log(`  inserted: ${fmt(result.counts.inserted)}  (total ${result.totalInserted})`);
  console.log(`  updated:  ${fmt(result.counts.updated)}`);
  console.log(`  skipped:  ${fmt(result.counts.skipped)}`);
  if (result.credentials.length > 0) {
    const dir = path.resolve(process.cwd(), "backups");
    fs.mkdirSync(dir, { recursive: true });
    const csvPath = path.join(dir, `credentials-${result.batchId}.csv`);
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const lines = ["کلاس,نام,شناسهٴ ورود,رمز اولیه", ...result.credentials.map((c) => [c.className, c.name, c.loginIdentifier, c.initialPassword].map(esc).join(","))];
    fs.writeFileSync(csvPath, `﻿${lines.join("\r\n")}\r\n`, "utf8");
    console.log(`  credentials: ${result.credentials.length} account(s) → ${csvPath}  (plaintext; hand out and delete)`);
  }
}

/** `pg_dump -Fc` before a commit (IMPORT_PRE_DUMP=1 default); a failure only warns — the import is still in one tx. */
function preDump(tag: string): void {
  if (process.env.IMPORT_PRE_DUMP === "0") return;
  const dir = path.resolve(process.cwd(), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `pre-import-${tag}-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`);
  const cmd = process.env.IMPORT_DUMP_CMD ?? "docker compose -f docker-compose.dev.yml exec -T db pg_dump -Fc -U postgres -d app";
  try {
    const data = execSync(cmd, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1024 * 1024 * 1024 });
    fs.writeFileSync(out, data);
    console.log(`[import] pre-commit dump → ${out} (${(data.length / 1024).toFixed(0)} KB)`);
  } catch (err) {
    console.warn(`[import] WARNING: pre-commit pg_dump skipped (${err instanceof Error ? err.message.split("\n")[0] : String(err)}). Continuing — the commit is a single transaction.`);
  }
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      const e = err as { code?: string; message?: string };
      console.error(`[import] FAILED${e.code ? ` (${e.code})` : ""}:`, e.message ?? err);
      process.exit(1);
    });
}
