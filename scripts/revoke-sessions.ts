// Revoke live sessions (iam.user_session.revoked_at = now()) — the incident-response lever (docs/ops/incident.md).
//
//   pnpm sessions:revoke --user 09123000003        one account (phone or username, any digits)
//   pnpm sessions:revoke --org  demo-school --yes  every active member of one organization (slug)
//   pnpm sessions:revoke --all --yes               everyone (every school) — after a SESSION_SECRET / DB leak
//
// Runs as app_rw through the same boundary as the app (`withoutTenant` for the global user_session / user_account /
// organization tables, `withTenant` to list the memberships of ONE organization under RLS) and reuses
// `revokeAllForUser` from src/modules/iam/session.ts. Reads DATABASE_URL etc. from ./.env like the other scripts.
// Affected users are simply logged out; nothing else changes (passwords, must_change_password stay as they are).
import fs from "node:fs";
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

interface Args {
  user?: string;
  org?: string;
  all: boolean;
  yes: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { all: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--user") args.user = argv[++i];
    else if (a === "--org") args.org = argv[++i];
    else if (a === "--all") args.all = true;
    else if (a === "--yes" || a === "-y") args.yes = true;
    else usage(`unknown argument ${a}`);
  }
  const modes = [args.user !== undefined, args.org !== undefined, args.all].filter(Boolean).length;
  if (modes !== 1) usage("pass exactly one of --user <login> | --org <slug> | --all");
  if ((args.org !== undefined || args.all) && !args.yes) usage("--org and --all need --yes (they log out many people)");
  return args;
}

function usage(msg: string): never {
  console.error(`revoke-sessions: ${msg}\n  --user <phone|username>\n  --org <slug> --yes\n  --all --yes`);
  process.exit(2);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadDotEnv();

  // Dynamic imports: src/lib/env.ts validates process.env at import time, so .env must be loaded first.
  const { eq, isNull, sql } = await import("drizzle-orm");
  const { withTenant, withoutTenant } = await import("../src/db/client");
  const { normalizePhoneIR, toAsciiDigits } = await import("../src/lib/normalize");
  const { findAccountByIdentifier } = await import("../src/modules/iam/repo");
  const { revokeAllForUser } = await import("../src/modules/iam/session");
  const { organizationMembership, userSession } = await import("../src/modules/iam/schema");
  const { organization } = await import("../src/modules/tenancy/schema");

  if (args.user !== undefined) {
    // Same normalisation as loginAction: phone-looking → E.164, otherwise lower-cased username.
    const ascii = toAsciiDigits(args.user.trim());
    const identifier = /^[+\d][\d\s\-().]*$/.test(ascii) ? (normalizePhoneIR(ascii) ?? ascii.replace(/[\s\-().]/g, "")) : ascii.toLowerCase();
    const revoked = await withoutTenant(async (tx) => {
      const account = await findAccountByIdentifier(tx, identifier);
      if (!account) throw new Error(`no user_account with login_identifier ${identifier}`);
      return revokeAllForUser(tx, account.id);
    });
    console.log(`revoked ${revoked} session(s) of ${identifier}`);
    return;
  }

  if (args.org !== undefined) {
    const slug = args.org.trim().toLowerCase();
    const org = await withoutTenant(async (tx) => {
      const rows = await tx.select({ id: organization.id, name: organization.name }).from(organization).where(eq(organization.slug, slug)).limit(1);
      return rows[0] ?? null;
    });
    if (!org) throw new Error(`no organization with slug ${slug}`);
    // Memberships are a tenant table: list them under this organization's RLS context, then revoke globally.
    const accountIds = await withTenant({ orgId: org.id }, async (tx) => {
      const rows = await tx
        .selectDistinct({ userAccountId: organizationMembership.userAccountId })
        .from(organizationMembership)
        .where(eq(organizationMembership.status, "active"));
      return rows.map((r) => r.userAccountId);
    });
    let revoked = 0;
    await withoutTenant(async (tx) => {
      for (const id of accountIds) revoked += await revokeAllForUser(tx, id);
    });
    console.log(`revoked ${revoked} session(s) of ${accountIds.length} member(s) of ${org.name} (${slug})`);
    return;
  }

  const revoked = await withoutTenant(async (tx) => {
    const rows = await tx
      .update(userSession)
      .set({ revokedAt: sql`now()` })
      .where(isNull(userSession.revokedAt))
      .returning({ id: userSession.id });
    return rows.length;
  });
  console.log(`revoked ${revoked} session(s) across every organization`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
