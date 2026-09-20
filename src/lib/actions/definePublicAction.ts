// The pre-authentication gate. Exactly ONE action legitimately runs before a session exists: login. It still
// parses a `.strict()` schema and maps errors like defineAction, but instead of a tenant transaction it receives
// `globalTx` (= withoutTenant: global tables only — user_account, auth_identity, user_session, login_attempt,
// organization) and `bindAccount` (= bindAccountContext: exposes organization_membership rows of ONE verified
// account through the `account_memberships` policy for the rest of that transaction). Only public actions get
// these tools, so the account-context binding cannot be reached from authenticated module code.
import { z } from "zod";
import { bindAccountContext, withoutTenant, type Tx } from "@/db/client";
import { getRequestId } from "@/lib/ctx";
import { ok, toPlainInput, toResult, type Result } from "./defineAction";

export interface PublicTools {
  requestId: string;
  globalTx: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  /** Bind the verified account (from the user_account row, never from input) for the rest of `tx`. */
  bindAccount: (tx: Tx, userAccountId: string) => Promise<void>;
}

export function definePublicAction<S extends z.ZodType, R>(
  opts: { schema: S },
  handler: (input: z.output<S>, tools: PublicTools) => Promise<R>,
): (raw: FormData | unknown) => Promise<Result<R>> {
  return async (raw) => {
    const requestId = await getRequestId();
    try {
      const input = opts.schema.parse(toPlainInput(raw)) as z.output<S>;
      const data = await handler(input, { requestId, globalTx: withoutTenant, bindAccount: bindAccountContext });
      return ok(data);
    } catch (err) {
      return toResult(err, requestId);
    }
  };
}
