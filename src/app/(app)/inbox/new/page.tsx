import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { newWorkItemOptionsQuery } from "@/modules/workspace/queries";
import { NewWorkItemForm } from "@/modules/workspace/ui/NewWorkItemForm";

export const metadata: Metadata = { title: "کار جدید | سامانهٴ مدرسه" };

export default async function NewWorkItemPage() {
  const options = await newWorkItemOptionsQuery();
  if (!options.ok) {
    if (options.code === "UNAUTHENTICATED") redirect("/login");
    return (
      <EmptyState
        title="شما نمی‌توانید کار جدید بسازید"
        description="ایجاد کار برای معلمان و کادر مدرسه است."
        action={
          <Button asChild variant="outline" className="h-11">
            <Link href="/inbox">بازگشت به پنل من</Link>
          </Button>
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-4 px-4 pt-3 pb-6 md:pt-6">
      <Link href="/inbox" className="inline-flex min-h-11 items-center gap-1 self-start text-sm text-text-muted hover:text-text">
        <ArrowRight className="size-4" aria-hidden />
        پنل من
      </Link>
      <h2 className="text-xl font-bold text-text">کار جدید</h2>
      <NewWorkItemForm offerings={options.data.offerings} canPickPersons={options.data.canPickPersons} />
    </div>
  );
}
