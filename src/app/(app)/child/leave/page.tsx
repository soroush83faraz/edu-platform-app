import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { ChildPageHeader, ChildSwitcher } from "@/components/guardian/ChildParts";
import { LeaveRequestForm } from "@/components/guardian/LeaveRequestForm";
import { MyLeaves } from "@/components/guardian/MyLeaves";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageSection } from "@/components/layout/PageSection";
import { childParam } from "@/modules/iam/guardian-policy";
import { childLeaveQuery } from "@/modules/iam/guardian-leave-queries";

export const metadata: Metadata = { title: "درخواست مرخصی" };

/**
 * «درخواست مرخصی» (a guardian, owner 2026-10-20): ask the school for a leave (excused absence) for one child — a range
 * of at most 14 days or part of one day — and follow the answer. `?child=` is validated on the server (NOT_FOUND for
 * anything but the guardian's own live child); the school's زنگ‌ها for the partial day are the child's school's.
 */
export default async function ChildLeavePage({ searchParams }: { searchParams: Promise<{ child?: string | string[] }> }) {
  const res = await childLeaveQuery({ child: childParam((await searchParams).child) });
  if (!res.ok) {
    if (res.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const { children, child, requests, periods } = res.data;
  return (
    <ContentWidth size="reading" className="reveal-stagger">
      <ChildPageHeader title="درخواست مرخصی" child={child} />
      <ChildSwitcher items={children} current={child.studentProfileId} page="leave" />
      <PageSection id="new-leave" title="درخواست تازه" surface="work">
        {!res.data.schoolId ? (
          <p className="text-sm text-text-muted">{child.firstName} هنوز در مدرسه‌ای ثبت‌نام فعال ندارد؛ درخواست مرخصی ممکن نیست.</p>
        ) : !res.data.enabled ? (
          <p className="text-sm text-text-muted">مدرسهٴ {child.firstName} فعلاً درخواست مرخصی را از این‌جا نمی‌پذیرد؛ برای مرخصی با مدرسه تماس بگیرید.</p>
        ) : (
          <LeaveRequestForm child={child.studentProfileId} childFirstName={child.firstName} periods={periods.map((p) => ({ periodNo: p.periodNo, label: p.label }))} />
        )}
      </PageSection>
      <PageSection id="my-leaves" title="درخواست‌های مرخصی" count={requests.length > 0 ? requests.length : undefined}>
        {requests.length === 0 ? (
          <EmptyState title={`هنوز برای ${child.firstName} مرخصی نخواسته‌اید`} description="پاسخ مدرسه به هر درخواست همین‌جا می‌آید و خبرش را در اعلان‌ها می‌بینید." className="surface-work" />
        ) : (
          <MyLeaves requests={requests} />
        )}
      </PageSection>
    </ContentWidth>
  );
}
