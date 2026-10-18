import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { AuthBrand } from "@/components/auth/AuthBrand";
import { cn } from "@/lib/cn";
import type { DemoDirectory } from "../demo-login/labels";
import { LOGGED_OUT_MESSAGE } from "../messages";
import { DemoDock } from "./DemoDock";
import { LoginForm } from "./LoginForm";

/**
 * The login page's picture (mock docs/mockups/login-v6.html), apart from its data and redirects
 * (src/app/(auth)/login/page.tsx). Phone: the glass «D» and the wordmark on top, the card below — it fits 360 px.
 * Desktop (lg): two columns, the card at the START (right, in RTL) and the art + the product sentence at the end.
 * The card: «ورود به حساب» (no subtitle), the form, the one helper line; «راهنما · حریم خصوصی» under it. The
 * «ورود آزمایشی» pill only when the server handed a directory (its gate was open).
 */
export function LoginScene({ loggedOut, next, demo }: { loggedOut: boolean; next: string | null; demo: DemoDirectory | null }) {
  return (
    <>
      <div
        className={cn(
          "mx-auto flex w-full max-w-[26rem] flex-1 flex-col gap-4 px-4 pt-[max(1.75rem,env(safe-area-inset-top))]",
          "lg:grid lg:max-w-[70rem] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:content-center lg:items-center lg:gap-16 lg:px-12 lg:py-12 xl:px-20",
          demo ? "pb-[max(5.5rem,env(safe-area-inset-bottom))]" : "pb-[max(2rem,env(safe-area-inset-bottom))]",
        )}
      >
        <AuthBrand className="lg:order-2" />
        <div className="flex w-full flex-col gap-2 lg:max-w-[26rem] lg:justify-self-center">
          <section aria-labelledby="login-title" className="auth-glass px-5 pt-6 pb-5">
            <h1 id="login-title" className="text-xl font-extrabold text-(--auth-text)">
              ورود به حساب
            </h1>
            {loggedOut ? (
              <p role="status" className="mt-3 flex items-center gap-2 rounded-xl bg-(--auth-success-soft) px-3 py-2 text-sm font-medium text-(--auth-success)">
                <CheckCircle2 className="size-4 shrink-0" aria-hidden />
                {LOGGED_OUT_MESSAGE}
              </p>
            ) : null}
            <div className="mt-4">
              <LoginForm next={next} />
            </div>
            <p className="mt-4 text-center text-meta text-(--auth-muted)">
              رمز را فراموش کرده‌اید؟ <b className="font-semibold text-(--auth-text)">مدیر یا معاون مدرسه</b> رمز موقت می‌دهد.
            </p>
          </section>
          {/* The two pages anyone may read before signing in (the (public) route group; src/proxy.ts lists them as public). */}
          <nav aria-label="راهنما و حریم خصوصی" className="flex items-center justify-center gap-1 text-meta">
            <Link href="/help" className="inline-flex min-h-11 items-center rounded-lg px-3 text-(--auth-link) hover:text-(--auth-text)">
              راهنما
            </Link>
            <span aria-hidden className="text-(--auth-faint)">
              ·
            </span>
            <Link href="/privacy" className="inline-flex min-h-11 items-center rounded-lg px-3 text-(--auth-link) hover:text-(--auth-text)">
              حریم خصوصی
            </Link>
          </nav>
        </div>
      </div>
      {demo ? <DemoDock directory={demo} /> : null}
    </>
  );
}
