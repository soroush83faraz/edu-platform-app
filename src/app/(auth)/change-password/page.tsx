import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthBrand } from "@/components/auth/AuthBrand";
import { getRequestContext } from "@/lib/ctx";
import { logoutAction } from "@/modules/iam/actions";
import { ChangePasswordForm } from "@/modules/iam/ui/ChangePasswordForm";

export const metadata: Metadata = { title: "تغییر رمز" };

/** Forced first-login change or voluntary «تغییر رمز» — on the dark auth door: the small glass «D», then one glass card. */
export default async function ChangePasswordPage() {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/login");

  return (
    <div className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col justify-center gap-5 px-4 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <AuthBrand variant="compact" />
      <section aria-labelledby="change-password-title" className="auth-glass px-5 pt-6 pb-4">
        <h1 id="change-password-title" className="text-xl font-extrabold text-(--auth-text)">
          {ctx.mustChangePassword ? "تعیین رمز جدید" : "تغییر رمز"}
        </h1>
        <p className="mt-1 text-sm text-(--auth-muted)">
          {ctx.mustChangePassword
            ? "برای اولین ورود باید رمز اولیه را با رمزی که فقط خودتان می‌دانید جایگزین کنید."
            : "رمز فعلی را وارد کنید و رمز جدید را دو بار بنویسید."}
        </p>
        <div className="mt-5">
          {/* Voluntary change asks for the current password; the forced first-login change does not (the server enforces both). */}
          <ChangePasswordForm requireCurrent={!ctx.mustChangePassword} />
        </div>
        <form action={logoutAction} className="mt-3 flex justify-center">
          <button
            type="submit"
            className="pressable inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-medium text-(--auth-link) hover:bg-white/5 hover:text-(--auth-text)"
          >
            خروج از حساب
          </button>
        </form>
      </section>
    </div>
  );
}
