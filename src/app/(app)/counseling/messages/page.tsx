import { MessageSquareText } from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { MessageStateTag } from "@/components/guardian/MyMessages";
import { RelativeTime } from "@/components/RelativeTime";
import { RowMark } from "@/components/RowMark";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { GuardianMessageAnswer } from "@/modules/counseling/ui/GuardianMessageAnswer";
import { addressedMessagesQuery } from "@/modules/iam/guardian-message-queries";

export const metadata: Metadata = { title: "پیام‌های اولیا" };

/**
 * «پیام‌های اولیا» of a counselor (owner 2026-10-19 — «ارتباط ولی و مدرسه»): the guardians' messages given to them —
 * a counselor holds no `workspace.*` permission and so has no «پنل من»; here they read each message (the guardian,
 * the child, the subject and the text) and answer it with «ثبت پاسخ» (required text; the first answer closes it for
 * every counselor it went to). Only the caller's own addressed messages — nobody else's. Open ones first.
 */
export default async function CounselingMessagesPage() {
  const res = await addressedMessagesQuery();
  if (!res.ok) {
    if (res.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const rows = res.data;
  const open = rows.filter((r) => r.open).length;
  return (
    <ContentWidth size="reading" className="reveal-stagger">
      <PageHeader title="پیام‌های اولیا" count={open > 0 ? `${open.toLocaleString("fa-IR")} در انتظار پاسخ` : undefined} back={{ href: "/counseling", label: "مشاوره" }} />
      {rows.length === 0 ? (
        <EmptyState title="پیامی از اولیا برای شما نرسیده است" description="وقتی ولی‌ای برای مشاور مدرسه پیام بفرستد، همین‌جا می‌آید و خبرش را در اعلان‌ها می‌بینید." className="surface-work" />
      ) : (
        <ul className="surface-work divide-y divide-line/70 overflow-hidden">
          {rows.map((m) => (
            <li key={m.workItemId} className="flex flex-col gap-2 px-3.5 py-3">
              <div className="flex items-start gap-3">
                <RowMark icon={MessageSquareText} />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="text-row font-medium text-text">
                    <bdi>{m.title}</bdi>
                  </p>
                  <p className="text-meta text-text-muted">
                    از <bdi>{m.fromName}</bdi>
                    <span aria-hidden> · </span>
                    <RelativeTime at={m.sentAt} mode="time" />
                  </p>
                </div>
                <MessageStateTag state={m.answer ? "answered" : "sent"} />
              </div>
              <div className="ms-11 flex flex-col gap-1">
                {m.subject ? (
                  <p className="text-sm font-medium text-text">
                    <bdi>{m.subject}</bdi>
                  </p>
                ) : null}
                <p className="text-sm leading-7 whitespace-pre-wrap text-text">
                  <bdi>{m.body}</bdi>
                </p>
              </div>
              {m.answer ? (
                <section aria-label="پاسخ" className="surface-panel ms-11 flex flex-col gap-1 px-3.5 py-2.5">
                  <p className="text-meta text-text-muted">
                    پاسخ{m.answeredBy ? <> · <bdi>{m.answeredBy}</bdi></> : null}
                    {m.answeredAt ? (
                      <>
                        <span aria-hidden> · </span>
                        <RelativeTime at={m.answeredAt} mode="time" />
                      </>
                    ) : null}
                  </p>
                  <p className="text-sm leading-7 whitespace-pre-wrap text-text">
                    <bdi>{m.answer}</bdi>
                  </p>
                </section>
              ) : m.open ? (
                <div className="ms-11">
                  <GuardianMessageAnswer workItemId={m.workItemId} studentName={m.studentName} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </ContentWidth>
  );
}
