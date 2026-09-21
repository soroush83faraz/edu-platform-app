import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { getRequestContext } from "@/lib/ctx";

/**
 * The «back» line at the top of /help and /privacy: to «بیشتر» for a signed-in reader, to «تغییر رمز» while a
 * forced change is pending (the only page such a session may use), to «ورود» for everyone else. Server Component;
 * `getRequestContext()` is cached per request, so this costs the layout's lookup nothing extra.
 */
export async function PublicBackLink() {
  const ctx = await getRequestContext();
  const target = !ctx ? { href: "/login", label: "ورود" } : ctx.mustChangePassword ? { href: "/change-password", label: "تغییر رمز" } : { href: "/more", label: "بیشتر" };
  return (
    <Link href={target.href} className="inline-flex min-h-11 items-center gap-1 self-start text-sm text-text-muted hover:text-text">
      <ArrowRight className="size-4" aria-hidden />
      {target.label}
    </Link>
  );
}
