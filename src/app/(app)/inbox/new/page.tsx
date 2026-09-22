import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { newWorkItemOptionsQuery } from "@/modules/workspace/queries";
import { NewWorkItemForm } from "@/modules/workspace/ui/NewWorkItemForm";

export const metadata: Metadata = { title: "تکلیف جدید | سامانهٴ مدرسه" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?offering=<id>` (from a subject page) pre-selects that درس in the class picker when the caller may send to it. */
export default async function NewWorkItemPage({ searchParams }: { searchParams: Promise<{ offering?: string }> }) {
  const sp = await searchParams;
  const options = await newWorkItemOptionsQuery();
  if (!options.ok) {
    if (options.code === "UNAUTHENTICATED") redirect("/login");
    return (
      <EmptyState
        title="شما نمی‌توانید تکلیف بدهید"
        description="دادن تکلیف با دبیران و کادر مدرسه است."
        action={
          <Button asChild variant="outline">
            <Link href="/inbox">بازگشت به پنل من</Link>
          </Button>
        }
      />
    );
  }
  return (
    <ContentWidth size="reading" className="gap-4">
      <PageHeader back={{ href: "/inbox", label: "پنل من" }} title="تکلیف جدید" />
      <NewWorkItemForm
        offerings={options.data.offerings}
        canPickPersons={options.data.canPickPersons}
        initialOfferingId={sp.offering && UUID_RE.test(sp.offering) && options.data.offerings.some((o) => o.id === sp.offering) ? sp.offering : undefined}
      />
    </ContentWidth>
  );
}
