// The demo quick-login gate («ورود آزمایشی», docs/decisions.md 2026-10-18) — the ONE pre-authentication entry point
// besides login (`definePublicAction`). It exists only for the pilot period and only for organizations listed in
// DEMO_LOGIN_ORGS; the go-live checklist switches it off before real schools.
//
// Before it even parses the input it requires the whole gate (src/lib/demo-login/gate): DEMO_LOGIN=1 with a complete
// configuration AND a valid, unexpired unlock cookie (`__Host-demo`, minted by /login/demo for the right
// DEMO_LOGIN_KEY). Anything less answers NOT_FOUND — byte-for-byte what a feature that does not exist answers, so a
// stranger learns neither that it is on nor which input it would take. Then the `.strict()` schema, then the handler.
//
// The handler's tools are definePublicAction's (`globalTx`, `bindAccount`) plus `demoOrgTx(orgId, fn)`: a tenant
// transaction that opens ONLY for an organization whose slug is on the allow-list — verified inside that very
// transaction, before `fn` runs — so no demo code can read or write a tenant outside DEMO_LOGIN_ORGS, whatever id
// it is handed. Organization ids come from database rows, never from input.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { bindAccountContext, withTenant, withoutTenant, type Tx } from "@/db/client";
import { getRequestId } from "@/lib/ctx";
import { demoConfig, demoGateOpen } from "@/lib/demo-login/gate";
import { notFound } from "@/lib/errors";
import { organization } from "@/modules/tenancy/schema";
import { ok, toPlainInput, toResult, type Result } from "./defineAction";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DemoTools {
  requestId: string;
  /** DEMO_LOGIN_ORGS, in the order written. */
  allowedOrgSlugs: readonly string[];
  /** = withoutTenant: global tables only (organization, user_account, user_session, …). */
  globalTx: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  /** Bind an account id taken from a `user_account` row (never from input) for the rest of `tx` — see definePublicAction. */
  bindAccount: (tx: Tx, userAccountId: string) => Promise<void>;
  /** A tenant transaction for an allow-listed organization; NOT_FOUND for any other id. */
  demoOrgTx: <T>(orgId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;
}

export function defineDemoAction<S extends z.ZodType, R>(
  opts: { schema: S },
  handler: (input: z.output<S>, tools: DemoTools) => Promise<R>,
): (raw: FormData | unknown) => Promise<Result<R>> {
  return async (raw) => {
    const requestId = await getRequestId();
    try {
      const cfg = demoConfig();
      if (!(await demoGateOpen(cfg))) throw notFound();
      const input = opts.schema.parse(toPlainInput(raw)) as z.output<S>;
      const allowed = new Set(cfg.orgSlugs);
      const demoOrgTx = async <T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> => {
        if (!UUID_RE.test(orgId)) throw notFound();
        return withTenant({ orgId }, async (tx) => {
          const rows = await tx.select({ slug: organization.slug }).from(organization).where(eq(organization.id, orgId)).limit(1);
          if (!rows[0] || !allowed.has(rows[0].slug)) throw notFound();
          return fn(tx);
        });
      };
      const data = await handler(input, {
        requestId,
        allowedOrgSlugs: cfg.orgSlugs,
        globalTx: withoutTenant,
        bindAccount: bindAccountContext,
        demoOrgTx,
      });
      return ok(data);
    } catch (err) {
      return toResult(err, requestId);
    }
  };
}
