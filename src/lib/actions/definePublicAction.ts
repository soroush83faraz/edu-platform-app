// The pre-authentication gate. Exactly ONE action legitimately runs before a session exists: login. It still
// parses a `.strict()` schema and maps errors like defineAction, but instead of a tenant transaction it receives
// `globalTx` (= withoutTenant: global tables only — user_account, auth_identity, user_session, login_attempt,
// organization; plus organization_membership through the `account_memberships` policy after binding the account).
import { z } from "zod";
import { withoutTenant, type Tx } from "@/db/client";
import { getRequestId } from "@/lib/ctx";
import { ok, toPlainInput, toResult, type Result } from "./defineAction";

export interface PublicTools {
  requestId: string;
  globalTx: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
}

export function definePublicAction<S extends z.ZodType, R>(
  opts: { schema: S },
  handler: (input: z.output<S>, tools: PublicTools) => Promise<R>,
): (raw: FormData | unknown) => Promise<Result<R>> {
  return async (raw) => {
    const requestId = await getRequestId();
    try {
      const input = opts.schema.parse(toPlainInput(raw)) as z.output<S>;
      const data = await handler(input, { requestId, globalTx: withoutTenant });
      return ok(data);
    } catch (err) {
      return toResult(err, requestId);
    }
  };
}
