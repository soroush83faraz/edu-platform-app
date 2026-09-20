import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { getRequestContext } from "@/lib/ctx";

/**
 * The signed-in shell. The context comes from the database (cookie → session → membership), so a stale or
 * forged cookie lands on /login here even if proxy.ts let the request through. The nav gets the initial badge
 * counts server-side; a role without `workspace.work_item.read` simply shows none.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/login");
  if (ctx.mustChangePassword) redirect("/change-password");
  return <AppShell ctx={ctx}>{children}</AppShell>;
}
