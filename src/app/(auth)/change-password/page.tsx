import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { getRequestContext } from "@/lib/ctx";
import { logoutAction } from "@/modules/iam/actions";
import { ChangePasswordForm } from "@/modules/iam/ui/ChangePasswordForm";

export const metadata: Metadata = { title: "تغییر رمز | سامانهٴ مدرسه" };

export default async function ChangePasswordPage() {
  const ctx = await getRequestContext();
  if (!ctx) redirect("/login");

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">{ctx.mustChangePassword ? "تعیین رمز جدید" : "تغییر رمز"}</CardTitle>
        <CardDescription>
          {ctx.mustChangePassword
            ? "برای اولین ورود باید رمز اولیه را با رمزی که فقط خودتان می‌دانید جایگزین کنید."
            : "رمز جدید را دو بار وارد کنید."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChangePasswordForm />
      </CardContent>
      <CardFooter className="justify-between">
        <form action={logoutAction}>
          <Button type="submit" variant="ghost">
            خروج از حساب
          </Button>
        </form>
      </CardFooter>
    </Card>
  );
}
