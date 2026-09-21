import { CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BookClay } from "@/components/illustrations";
import { getRequestContext } from "@/lib/ctx";
import { LOGGED_OUT_MESSAGE } from "@/modules/iam/messages";
import { safeNextPath } from "@/modules/iam/next-path";
import { LoginForm } from "@/modules/iam/ui/LoginForm";

export const metadata: Metadata = { title: "ورود | سامانهٴ مدرسه" };

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

  return (
    <div className="rounded-hero bg-surface p-6 shadow-1">
      <div className="flex flex-col items-center gap-2 text-center">
        <BookClay size={96} />
        <h1 className="text-xl font-bold text-text">ورود به سامانه</h1>
        <p className="text-sm text-text-muted">با شمارهٴ موبایل یا نام‌کاربری و رمزتان وارد شوید.</p>
      </div>
      {loggedOut ? (
        <p role="status" className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-success-soft px-3 py-2 text-sm font-medium text-success">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          {LOGGED_OUT_MESSAGE}
        </p>
      ) : null}
      <div className="mt-6">
        <LoginForm next={next} />
      </div>
    </div>
  );
}
