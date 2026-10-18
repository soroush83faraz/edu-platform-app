import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getRequestContext } from "@/lib/ctx";
import { DEMO_KEY_PARAM_MAX } from "@/lib/demo-login/unlock";
import { loadDemoDirectory } from "@/modules/iam/demo-login/directory";
import { safeNextPath } from "@/modules/iam/next-path";
import { LoginScene } from "@/modules/iam/ui/LoginScene";

export const metadata: Metadata = { title: "ورود" };

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * `?out=1` = just logged out (src/proxy.ts adds Clear-Site-Data to that response); `?next=/inbox/<id>` = the deep
 * link the proxy preserved when a protected path was requested without a session — accepted only as a same-origin
 * relative path (`safeNextPath`), never an absolute URL. `?demo=<key>` = the owner unlocking «ورود آزمایشی» on this
 * device: forwarded to /login/demo (a page cannot set a cookie) whether or not the feature is on, so the answer is
 * the same either way. The «ورود آزمایشی» list is read only when its gate is open (`loadDemoDirectory`: NOT_FOUND
 * otherwise, and then no pill renders).
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  if (typeof sp.demo === "string" && sp.demo.length > 0 && sp.demo.length <= DEMO_KEY_PARAM_MAX) {
    redirect(`/login/demo?key=${encodeURIComponent(sp.demo)}`);
  }
  const loggedOut = sp.out === "1";
  const next = safeNextPath(sp.next);

  // A live session has no business here; a dead cookie simply renders the form.
  const ctx = await getRequestContext();
  if (ctx) redirect(ctx.mustChangePassword ? "/change-password" : (next ?? "/home"));

  const demo = await loadDemoDirectory({});
  return <LoginScene loggedOut={loggedOut} next={next} demo={demo.ok && demo.data.schools.length > 0 ? demo.data : null} />;
}
