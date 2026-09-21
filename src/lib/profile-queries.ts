// Read model of the «بیشتر» profile card: the caller's own login identifier (a phone or a generated username).
// `Ctx` carries display names only; the identifier is read here, for the session's own account, under the same
// gate as every other query (any signed-in role holds `notif.notification.read`).
import { eq } from "drizzle-orm";
import { defineQuery } from "@/lib/actions";
import { userAccount } from "@/modules/iam/schema";

export const myLoginIdentifierQuery = defineQuery({ permission: "notif.notification.read", scope: "any" }, async (tx, _input, ctx): Promise<string | null> => {
  const [row] = await tx.select({ loginIdentifier: userAccount.loginIdentifier }).from(userAccount).where(eq(userAccount.id, ctx.userId)).limit(1);
  return row?.loginIdentifier ?? null;
});
