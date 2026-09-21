import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { getRequestContext, loginRedirectHref } from "@/lib/ctx";

/**
 * The signed-in shell. The context comes from the database (cookie → session → membership), so a stale or
 * forged cookie lands on /login here even if proxy.ts let the request through — with the requested page as
 * `?next=` (`loginRedirectHref`), the same deep-link rule as the proxy's cookie-less redirect. The nav gets the
 * initial badge counts server-side; a role without `workspace.work_item.read` simply shows none.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getRequestContext();
  if (!ctx) redirect(await loginRedirectHref());
  if (ctx.mustChangePassword) redirect("/change-password");
  return <AppShell ctx={ctx}>{children}</AppShell>;
}
