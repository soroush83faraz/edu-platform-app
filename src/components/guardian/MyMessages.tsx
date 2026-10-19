// «پیام‌های من» of «پیام به مدرسه» (a guardian, owner 2026-10-19): the guardian's own messages about one child, newest
// first — kind, subject, to whom, when, the status tag «ارسال‌شده» / «در انتظار پاسخ» (after a week) / «در حال ارجاع به
// مدیریت» (nobody left on it) / «پاسخ داده شد» — the waiting tags neutral, not a problem the guardian has to act on —
// and once answered the school's answer with its date (never who answered — the guardian reads the answer, not the
// school's people). The message's own text folds under «متن پیام». Static rows: the guardian never opens the work
// item itself. A Server Component.
import { Check, Clock, Hourglass, MessageSquareText, Share2 } from "lucide-react";
import { RelativeTime } from "@/components/RelativeTime";
import { RowMark } from "@/components/RowMark";
import { cn } from "@/lib/cn";
import { DESTINATION_LABELS, MESSAGE_KIND_LABELS, MESSAGE_STATE_LABELS, teacherDestinationLabel, type MessageState } from "@/modules/iam/guardian-message-policy";
import type { MyMessageRow } from "@/modules/iam/guardian-message-queries";

const STATE_TAG: Record<MessageState, { icon: typeof Check; className: string }> = {
  sent: { icon: Clock, className: "bg-primary-50 text-primary-700" },
  waiting: { icon: Hourglass, className: "bg-surface-sunken text-text-muted" },
  routing: { icon: Share2, className: "bg-surface-sunken text-text-muted" },
  answered: { icon: Check, className: "bg-success-soft text-success" },
};

function destinationOf(m: MyMessageRow): string {
  if (m.destination !== "teacher") return DESTINATION_LABELS[m.destination];
  if (m.subjectName && m.teacherName) return teacherDestinationLabel(m.subjectName, m.teacherName);
  return m.subjectName ? `دبیر ${m.subjectName}` : DESTINATION_LABELS.teacher;
}

export function MessageStateTag({ state }: { state: MessageState }) {
  const tag = STATE_TAG[state];
  const Icon = tag.icon;
  return (
    <span data-state={state} className={cn("inline-flex shrink-0 items-center gap-1 rounded-full py-0.5 ps-2 pe-2.5 text-xs font-semibold whitespace-nowrap", tag.className)}>
      <Icon className="size-3.5" strokeWidth={2} aria-hidden />
      {MESSAGE_STATE_LABELS[state]}
    </span>
  );
}

export function MyMessages({ messages }: { messages: MyMessageRow[] }) {
  return (
    <ul className="surface-work divide-y divide-line/70 overflow-hidden">
      {messages.map((m) => (
        <li key={m.id} className="flex flex-col gap-2 px-3.5 py-3">
          <div className="flex items-start gap-3">
            <RowMark icon={MessageSquareText} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="text-row font-medium text-text">
                <span className="text-text-muted">{MESSAGE_KIND_LABELS[m.kind]}: </span>
                <bdi>{m.subject}</bdi>
              </p>
              <p className="text-meta text-text-muted">
                به <bdi>{destinationOf(m)}</bdi>
                <span aria-hidden> · </span>
                <RelativeTime at={m.sentAt} mode="time" />
              </p>
            </div>
            <MessageStateTag state={m.state} />
          </div>
          {m.answer ? (
            <section aria-label="پاسخ مدرسه" className="surface-panel ms-11 flex flex-col gap-1 px-3.5 py-2.5">
              <p className="text-meta text-text-muted">
                پاسخ مدرسه
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
          ) : null}
          {m.body ? (
            <details className="ms-11">
              <summary className="flex min-h-11 cursor-pointer items-center text-meta text-text-muted">متن پیام</summary>
              <p className="pb-1 text-sm leading-7 whitespace-pre-wrap text-text">
                <bdi>{m.body}</bdi>
              </p>
            </details>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
