import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BookClay } from "@/components/illustrations";
import { getRequestContext } from "@/lib/ctx";
import { LoginForm } from "@/modules/iam/ui/LoginForm";

export const metadata: Metadata = { title: "ورود | سامانهٴ مدرسه" };

export default async function LoginPage() {
  // A live session has no business here; a dead cookie simply renders the form.
  const ctx = await getRequestContext();
  if (ctx) redirect(ctx.mustChangePassword ? "/change-password" : "/home");

  return (
    <div className="rounded-hero bg-surface p-6 shadow-1">
      <div className="flex flex-col items-center gap-2 text-center">
        <BookClay size={96} />
        <h1 className="text-xl font-bold text-text">ورود به سامانه</h1>
        <p className="text-sm text-text-muted">با شمارهٴ موبایل یا نام‌کاربری و رمزتان وارد شوید.</p>
      </div>
      <div className="mt-6">
        <LoginForm />
      </div>
    </div>
  );
}
