import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getRequestContext } from "@/lib/ctx";
import { safeNextPath } from "@/modules/iam/next-path";
import { LoginScene } from "@/modules/iam/ui/LoginScene";

export const metadata: Metadata = { title: "ورود" };

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * `?out=1` = just logged out (src/proxy.ts adds Clear-Site-Data to that response); `?next=/inbox/<id>` = the deep
 * link the proxy preserved when a protected path was requested without a session — accepted only as a same-origin
 * relative path (`safeNextPath`), never an absolute URL.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const loggedOut = sp.out === "1";
  const next = safeNextPath(sp.next);

  // A live session has no business here; a dead cookie simply renders the form.
  const ctx = await getRequestContext();
  if (ctx) redirect(ctx.mustChangePassword ? "/change-password" : (next ?? "/home"));

  return <LoginScene loggedOut={loggedOut} next={next} />;
}
