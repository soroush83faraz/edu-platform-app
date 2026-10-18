import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ChildPageHeader, ChildSwitcher } from "@/components/guardian/ChildParts";
import { EmptyState } from "@/components/EmptyState";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { childParam } from "@/modules/iam/guardian-policy";
import { childWorkQuery } from "@/modules/iam/guardian-queries";
import { WorkItemList } from "@/modules/workspace/ui/WorkItemList";
import { isClosed } from "@/modules/workspace/work-item-list";

export const metadata: Metadata = { title: "تکالیف فرزند" };

/**
 * «تکالیف فرزند» (a guardian, owner 2026-10-18): the تکالیف given to the child — ONE `WorkItemList`, open rows first
 * then «انجام‌شده‌ها», the child's own state as each row's tag — READ-ONLY: no row opens, nothing can be marked. Never
 * the child's personal notes. `?child=` is validated on the server (NOT_FOUND for anything but the guardian's own).
 */
export default async function ChildWorkPage({ searchParams }: { searchParams: Promise<{ child?: string | string[] }> }) {
  const res = await childWorkQuery({ child: childParam((await searchParams).child) });
  if (!res.ok) {
    if (res.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const { children, child, rows } = res.data;
  const open = rows.filter((r) => !isClosed(r));
  const done = rows.filter((r) => isClosed(r));
  return (
    <ContentWidth size="reading" className="reveal-stagger">
      <ChildPageHeader title="تکالیف فرزند" child={child} />
      <ChildSwitcher items={children} current={child.studentProfileId} page="work" />
      {rows.length === 0 ? (
        <EmptyState title={`تکلیفی برای ${child.firstName} ثبت نشده است`} description="وقتی دبیران تکلیفی بدهند، با مهلت و وضعیتش همین‌جا می‌آید." className="surface-work" />
      ) : (
        <WorkItemList open={open} done={done} openEmpty={`تکلیفی در انتظارِ ${child.firstName} نیست.`} rowProps={{ readOnly: true }} />
      )}
    </ContentWidth>
  );
}
