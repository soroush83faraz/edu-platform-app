import { AppShell } from "@/components/shell/AppShell";
import { PublicShell } from "@/components/shell/PublicShell";
import { getRequestContext } from "@/lib/ctx";

/**
 * The pages anyone may read: /help and /privacy (src/proxy.ts lists them as public, so no cookie is required and
 * the login page links to them). A live session still gets the signed-in shell — the same page inside the app's
 * nav — while an anonymous visitor, or one with a pending forced password change, gets the light `PublicShell`
 * (nothing here must offer a way around /change-password). The pages themselves read `getRequestContext()`
 * (cached per request) only to tailor content and the back link; nothing on them needs a session.
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getRequestContext();
  if (ctx && !ctx.mustChangePassword) return <AppShell ctx={ctx}>{children}</AppShell>;
  return <PublicShell signedIn={ctx !== null}>{children}</PublicShell>;
}
