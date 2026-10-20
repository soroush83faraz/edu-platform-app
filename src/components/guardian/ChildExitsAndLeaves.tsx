// «مرخصی و خروج مجاز» on a child's «حضور و غیاب» page (a guardian, owner 2026-10-20): the authorized early exits of the
// last 30 days (the date, the time the school let the child leave, the reason category and who picked them up — never a
// manager's internal note) and the leaves that are approved or still waiting and not over yet. Static rows; the form
// and the full list live on «درخواست مرخصی». A Server Component.
import { CalendarX2, DoorOpen } from "lucide-react";
import Link from "next/link";
import { Chip } from "@/components/Chip";
import { RowMark } from "@/components/RowMark";
import { PageSection } from "@/components/layout/PageSection";
import { isoDateToJalali, toFaDigits } from "@/lib/format";
import { LEAVE_STATUS_TONES, earlyExitCategoryLabel, isLeaveStatus, leaveCategoryLabel, leaveSpanFa, leaveStatusLabel } from "@/lib/leave";
import { childHref } from "@/modules/iam/guardian-policy";
import type { ChildExitRow, ChildLeaveRow } from "@/modules/iam/guardian-leave-queries";

export function ChildExitsAndLeaves({ child, today, exits, requests }: { child: string; today: string; exits: ChildExitRow[]; requests: ChildLeaveRow[] }) {
  const leaves = requests.filter((r) => (r.status === "approved" || r.status === "pending") && r.toDate >= today);
  return (
    <PageSection
      id="leave-exits"
      title="مرخصی و خروج مجاز"
      count={exits.length + leaves.length > 0 ? exits.length + leaves.length : undefined}
      trailing={
        <Link prefetch={false} href={childHref("leave", child)} className="pressable inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-medium text-sky-strong hover:text-primary-700">
          درخواست مرخصی
        </Link>
      }
    >
      {exits.length + leaves.length === 0 ? (
        <p className="surface-panel px-4 py-3 text-sm text-text-muted">در ۳۰ روز گذشته خروج مجازی ثبت نشده و مرخصی فعالی نیست.</p>
      ) : (
        <ul className="surface-work divide-y divide-line/70 overflow-hidden">
          {exits.map((e) => (
            <li key={e.id} className="flex min-h-14 items-center gap-3 px-3.5 py-2">
              <RowMark icon={DoorOpen} />
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="text-row text-text">
                  خروج مجاز <span className="tabular text-text-muted">ساعت {toFaDigits(e.exitTime)}</span>
                </p>
                <p className="truncate text-meta text-text-muted">
                  <span className="tabular">{isoDateToJalali(e.date)}</span> · {earlyExitCategoryLabel(e.category)}
                  {e.pickedUpBy ? (
                    <>
                      {" · "}تحویل به <bdi>{e.pickedUpBy}</bdi>
                    </>
                  ) : null}
                </p>
              </div>
            </li>
          ))}
          {leaves.map((r) => (
            <li key={r.id} className="flex min-h-14 items-center gap-3 px-3.5 py-2">
              <RowMark icon={CalendarX2} />
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="tabular text-row text-text">{leaveSpanFa(r)}</p>
                <p className="truncate text-meta text-text-muted">{leaveCategoryLabel(r.category)}</p>
              </div>
              <Chip tone={isLeaveStatus(r.status) ? LEAVE_STATUS_TONES[r.status] : "neutral"}>{leaveStatusLabel(r.status)}</Chip>
            </li>
          ))}
        </ul>
      )}
    </PageSection>
  );
}
