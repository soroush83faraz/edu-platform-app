"use client";

// «درخواست‌های مرخصی» of the school's managers (owner, 2026-10-20): the pending requests of a guardian, each with the
// child, class, school, span, reason and note, an optional «توضیح برای ولی» and the two decisions — «تأیید» is the
// row's one primary action, «رد» the secondary — and, below them, the last weeks' answered requests. Also today's
// authorized exits with «لغو» for a mistaken one. The server decides the scope and the status again.
import { CalendarX2, ChevronDown, DoorOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Chip } from "@/components/Chip";
import { RowMark } from "@/components/RowMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatJalaliDateTime, toFaDigits } from "@/lib/format";
import { LEAVE_DECISION_NOTE_MAX, LEAVE_STATUS_TONES, earlyExitCategoryLabel, isLeaveStatus, leaveCategoryLabel, leaveSpanFa, leaveStatusLabel } from "@/lib/leave";
import { cancelEarlyExitAction, decideLeaveAction } from "../leave-actions";
import type { EarlyExitRow, LeaveQueueRow } from "../leave-queries";

function Who({ r, showSchool }: { r: LeaveQueueRow; showSchool: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <p className="text-row font-medium text-text">
        <bdi>{r.studentName}</bdi>
        {r.className ? (
          <span className="text-text-muted">
            {" · "}کلاس <bdi>{r.className}</bdi>
          </span>
        ) : null}
      </p>
      <p className="tabular text-meta text-text-muted">{leaveSpanFa(r)}</p>
      <p className="text-meta text-text-muted">
        {leaveCategoryLabel(r.category)}
        {" · "}درخواست <bdi>{r.requestedByName}</bdi>
        {showSchool ? (
          <>
            {" · "}
            <bdi>{r.schoolName}</bdi>
          </>
        ) : null}
      </p>
    </div>
  );
}

function PendingRow({ r, showSchool }: { r: LeaveQueueRow; showSchool: boolean }) {
  const ids = useId();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const decide = (decision: "approved" | "rejected") =>
    start(async () => {
      const res = await decideLeaveAction({ id: r.id, decision, note: note.trim() === "" ? null : note.trim() });
      if (!res.ok) {
        toast.error(res.message);
        router.refresh();
        return;
      }
      toast.success(decision === "approved" ? "مرخصی تأیید شد" : "درخواست رد شد");
      router.refresh();
    });
  return (
    <li className="flex flex-col gap-2.5 px-3.5 py-3">
      <div className="flex items-start gap-3">
        <RowMark icon={CalendarX2} />
        <Who r={r} showSchool={showSchool} />
        <Chip tone="warning">{leaveStatusLabel(r.status)}</Chip>
      </div>
      {r.note ? (
        <p className="ms-11 text-sm leading-7 whitespace-pre-wrap text-text-muted">
          <bdi>{r.note}</bdi>
        </p>
      ) : null}
      <div className="ms-11 flex flex-col gap-2">
        <label htmlFor={`${ids}-note`} className="sr-only">
          توضیح برای ولی
        </label>
        <Input id={`${ids}-note`} dir="auto" maxLength={LEAVE_DECISION_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} placeholder="توضیح برای ولی (اختیاری)" disabled={pending} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={pending} onClick={() => decide("approved")}>
            تأیید
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => decide("rejected")}>
            رد
          </Button>
        </div>
      </div>
    </li>
  );
}

export function PendingLeaves({ rows, showSchool }: { rows: LeaveQueueRow[]; showSchool: boolean }) {
  return (
    <ul className="surface-work divide-y divide-line/70 overflow-hidden">
      {rows.map((r) => (
        <PendingRow key={r.id} r={r} showSchool={showSchool} />
      ))}
    </ul>
  );
}

export function DecidedLeaves({ rows, showSchool }: { rows: LeaveQueueRow[]; showSchool: boolean }) {
  return (
    <ul className="surface-work divide-y divide-line/70 overflow-hidden">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-col gap-2 px-3.5 py-3">
          <div className="flex items-start gap-3">
            <RowMark icon={CalendarX2} />
            <Who r={r} showSchool={showSchool} />
            <Chip tone={isLeaveStatus(r.status) ? LEAVE_STATUS_TONES[r.status] : "neutral"}>{leaveStatusLabel(r.status)}</Chip>
          </div>
          {r.decidedAt || r.decisionNote ? (
            <details className="ms-11">
              <summary className="flex min-h-11 cursor-pointer items-center gap-1 text-meta text-text-muted">
                <ChevronDown className="size-4" aria-hidden />
                جزئیات تصمیم
              </summary>
              <p className="pb-1 text-sm leading-7 text-text">
                {r.decidedByName ? (
                  <>
                    <bdi>{r.decidedByName}</bdi>
                    {r.decidedAt ? <span className="tabular text-text-muted"> · {formatJalaliDateTime(r.decidedAt)}</span> : null}
                  </>
                ) : null}
                {r.decisionNote ? (
                  <>
                    <br />
                    <bdi>{r.decisionNote}</bdi>
                  </>
                ) : null}
              </p>
            </details>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ExitRow({ e, showSchool }: { e: EarlyExitRow; showSchool: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const cancel = () =>
    start(async () => {
      const res = await cancelEarlyExitAction({ id: e.id });
      if (!res.ok) {
        toast.error(res.message);
        router.refresh();
        return;
      }
      toast.success("خروج مجاز لغو شد");
      router.refresh();
    });
  return (
    <li className="flex items-center gap-3 px-3.5 py-3">
      <RowMark icon={DoorOpen} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-row font-medium text-text">
          <bdi>{e.studentName}</bdi>
          {e.className ? (
            <span className="text-text-muted">
              {" · "}کلاس <bdi>{e.className}</bdi>
            </span>
          ) : null}
        </p>
        <p className="text-meta text-text-muted">
          <span className="tabular">ساعت {toFaDigits(e.exitTime)}</span> · {earlyExitCategoryLabel(e.category)}
          {e.pickedUpBy ? (
            <>
              {" · "}تحویل به <bdi>{e.pickedUpBy}</bdi>
            </>
          ) : null}
          {showSchool ? (
            <>
              {" · "}
              <bdi>{e.schoolName}</bdi>
            </>
          ) : null}
        </p>
      </div>
      <Button type="button" variant="ghost" disabled={pending} onClick={cancel}>
        لغو
      </Button>
    </li>
  );
}

export function TodaysExits({ rows, showSchool }: { rows: EarlyExitRow[]; showSchool: boolean }) {
  return (
    <ul className="surface-work divide-y divide-line/70 overflow-hidden">
      {rows.map((e) => (
        <ExitRow key={e.id} e={e} showSchool={showSchool} />
      ))}
    </ul>
  );
}
