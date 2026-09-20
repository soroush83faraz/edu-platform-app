import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getRequestContext } from "@/lib/ctx";
import { LoginForm } from "@/modules/iam/ui/LoginForm";

export const metadata: Metadata = { title: "ورود | سامانهٴ مدرسه" };

export default async function LoginPage() {
  // A live session has no business here; a dead cookie simply renders the form.
  const ctx = await getRequestContext();
  if (ctx) redirect(ctx.mustChangePassword ? "/change-password" : "/home");

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">ورود به سامانه</CardTitle>
        <CardDescription>با شمارهٴ موبایل یا نام‌کاربری و رمز خود وارد شوید.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm />
      </CardContent>
    </Card>
  );
}
