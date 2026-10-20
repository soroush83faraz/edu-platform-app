"use client";

// «درخواست‌های من» of the guardian's «مرخصی» page (owner, 2026-10-20): each request of the child — span, reason, status
// tag (the waiting one warm, the answered ones success / danger), the school's decision note — and a 44 px «لغو
// درخواست» on the guardian's OWN pending ones. A neutral row, never a link: nothing here opens another page.
import { CalendarX2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Chip } from "@/components/Chip";
import { RowMark } from "@/components/RowMark";
import { Button } from "@/components/ui/button";
import { LEAVE_STATUS_TONES, isLeaveStatus, leaveCategoryLabel, leaveSpanFa, leaveStatusLabel } from "@/lib/leave";
import { cancelLeaveAction } from "@/modules/iam/guardian-leave-actions";
import type { ChildLeaveRow } from "@/modules/iam/guardian-leave-queries";

export function MyLeaves({ requests }: { requests: ChildLeaveRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const cancel = (id: string) =>
    start(async () => {
      const r = await cancelLeaveAction({ id });
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      toast.success("درخواست لغو شد");
      router.refresh();
    });

  return (
    <ul className="surface-work divide-y divide-line/70 overflow-hidden">
      {requests.map((r) => (
        <li key={r.id} className="flex flex-col gap-2 px-3.5 py-3">
          <div className="flex items-start gap-3">
            <RowMark icon={CalendarX2} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="tabular text-row font-medium text-text">{leaveSpanFa(r)}</p>
              <p className="text-meta text-text-muted">{leaveCategoryLabel(r.category)}</p>
            </div>
            <Chip tone={isLeaveStatus(r.status) ? LEAVE_STATUS_TONES[r.status] : "neutral"}>{leaveStatusLabel(r.status)}</Chip>
          </div>
          {r.note ? (
            <p className="ms-11 text-sm leading-7 whitespace-pre-wrap text-text-muted">
              <bdi>{r.note}</bdi>
            </p>
          ) : null}
          {r.decisionNote ? (
            <section aria-label="توضیح مدرسه" className="surface-panel ms-11 flex flex-col gap-1 px-3.5 py-2.5">
              <p className="text-meta text-text-muted">توضیح مدرسه</p>
              <p className="text-sm leading-7 whitespace-pre-wrap text-text">
                <bdi>{r.decisionNote}</bdi>
              </p>
            </section>
          ) : null}
          {r.status === "pending" && r.mine ? (
            <div className="ms-11">
              <Button type="button" variant="outline" disabled={pending} onClick={() => cancel(r.id)}>
                لغو درخواست
              </Button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
