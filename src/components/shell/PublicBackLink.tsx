import { BackLink } from "@/components/layout/BackLink";
import { getRequestContext } from "@/lib/ctx";

/**
 * The «back» control at the top of /help and /privacy: to «بیشتر» for a signed-in reader, to «تغییر رمز» while a
 * forced change is pending (the only page such a session may use), to «ورود» for everyone else. Drawn by the one
 * `BackLink`, so it reads exactly like every inner page's `PageHeader` back. Server Component;
 * `getRequestContext()` is cached per request, so this costs the layout's lookup nothing extra.
 */
export async function PublicBackLink() {
  const ctx = await getRequestContext();
  const target = !ctx ? { href: "/login", label: "ورود" } : ctx.mustChangePassword ? { href: "/change-password", label: "تغییر رمز" } : { href: "/more", label: "بیشتر" };
  return <BackLink href={target.href} label={target.label} />;
}
