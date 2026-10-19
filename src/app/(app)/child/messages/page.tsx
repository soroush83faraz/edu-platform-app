import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { ChildPageHeader, ChildSwitcher } from "@/components/guardian/ChildParts";
import { MessageComposer } from "@/components/guardian/MessageComposer";
import { MyMessages } from "@/components/guardian/MyMessages";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageSection } from "@/components/layout/PageSection";
import { childMessagesQuery } from "@/modules/iam/guardian-message-queries";
import { childParam } from "@/modules/iam/guardian-policy";

export const metadata: Metadata = { title: "پیام به مدرسه" };

/**
 * «پیام به مدرسه» (a guardian, owner 2026-10-19 — «ارتباط ولی و مدرسه»): a question / suggestion / criticism about the
 * child to one of the child's teachers or to the school's counselor, vice principal or principal, and «پیام‌های من»
 * with the status and the school's answer. `?child=` is validated on the server (NOT_FOUND for anything but the
 * guardian's own live child); the destinations are the child's school's, resolved on the server.
 */
export default async function ChildMessagesPage({ searchParams }: { searchParams: Promise<{ child?: string | string[] }> }) {
  const res = await childMessagesQuery({ child: childParam((await searchParams).child) });
  if (!res.ok) {
    if (res.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const { children, child, destinations, messages } = res.data;
  const canSend = destinations.teachers.length > 0 || destinations.offices.length > 0;
  return (
    <ContentWidth size="reading" className="reveal-stagger">
      <ChildPageHeader title="پیام به مدرسه" child={child} />
      <ChildSwitcher items={children} current={child.studentProfileId} page="messages" />
      <PageSection id="new-message" title="پیام تازه" surface="work">
        {canSend ? (
          <MessageComposer child={child.studentProfileId} childFirstName={child.firstName} teachers={destinations.teachers} offices={destinations.offices} />
        ) : (
          <p className="text-sm text-text-muted">در مدرسهٴ {child.firstName} هنوز گیرنده‌ای برای پیام ثبت نشده است.</p>
        )}
      </PageSection>
      <PageSection id="my-messages" title="پیام‌های من" count={messages.length > 0 ? messages.length : undefined}>
        {messages.length === 0 ? (
          <EmptyState title={`هنوز پیامی دربارهٴ ${child.firstName} نفرستاده‌اید`} description="پاسخ مدرسه به هر پیام همین‌جا می‌آید و خبرش را در اعلان‌ها می‌بینید." className="surface-work" />
        ) : (
          <MyMessages messages={messages} />
        )}
      </PageSection>
    </ContentWidth>
  );
}
