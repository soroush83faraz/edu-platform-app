"use client";

import { CalendarPlus, Check, CheckCheck, RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "cn";
import { ResponsiveModal } from "@/components/admin/ResponsiveModal";
import { JalaliDatePicker } from "@/components/pickers/JalaliDatePicker";
import { TimePicker, formatTimeFa } from "@/components/pickers/TimePicker";
import { Button } from "@/components/ui/button";
import { flatten } from "@/lib/form-errors";
import { formatJalaliDateTime, parseJalaliToInstant, tehranNow } from "@/lib/format";
import { formatHm, formatJalaliDay, formatJalaliDayLong, parseJalaliDay, tehranToday } from "@/lib/jalali-grid";
import type { WorkItemWords } from "@/lib/work-item-words";
import { changeStatusAction, extendDueAtAction, markInboxReadAction } from "../actions";
import type { StatusCategory } from "../repo";

export interface WorkItemActionsProps {
  workItemId: string;
  title: string;
  statusCategory: StatusCategory;
  dueAt: Date | null;
  assigneeCount: number;
  myAssigneeState: "pending" | "accepted" | "done" | null;
  isManager: boolean;
  canUpdate: boolean;
  /** My inbox row's state, or `null` when I have none — the only thing left of the personal entry in this row. */
  inboxState: string | null;
  /** The reader's noun set: «تکلیف» for a teacher, «تسک» for مدیر/معاون (src/lib/work-item-words). */
  words: WorkItemWords;
}

/**
 * The action row of a کار — named «تکلیف» or «تسک» by the reader's hats. An assignee gets «انجام شد». Its creator
 * (or a broad admin) gets the three creator actions — «اتمام» (primary: closes it for everyone), «تمدید»
 * (secondary: a later due date), «حذف» (ghost, red) — or «بازگشایی» once it is closed. «حذف» is a LABEL: the
 * stored status is still `cancelled`, nothing leaves the database and «بازگشایی» brings the item back (owner,
 * round 4). There is no overflow menu: سنجاق / بایگانی left the UI (owner, round 5 — «if the teacher wants, they
 * can delete it»); `setPinned` / `archiveInbox` stay in the service, unwired. Full-width and stacked on phones,
 * one inline row from `sm:`, every target 44 px. Marks my inbox row read once on mount.
 */
export function WorkItemActions({ workItemId, title, statusCategory, dueAt, assigneeCount, myAssigneeState, isManager, canUpdate, inboxState, words }: WorkItemActionsProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // `"cancel"` is the `cancelled` transition — the button that used to read «کنسل» and now reads «حذف».
  const [confirm, setConfirm] = useState<"done" | "cancel" | null>(null);
  const [extending, setExtending] = useState(false);

  useEffect(() => {
    if (inboxState !== "unread") return;
    void markInboxReadAction({ workItemId }).then((r) => {
      if (r.ok && r.data.changed) router.refresh();
    });
  }, [inboxState, workItemId, router]);

  const run = (label: string, fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(label);
        router.refresh();
      } else toast.error(r.message ?? "خطایی رخ داد.");
    });

  const closed = statusCategory === "done" || statusCategory === "cancelled";
  const isAssignee = myAssigneeState !== null;
  const manager = canUpdate && isManager;
  const buttonClass = "w-full sm:w-auto";
  const buttons: React.ReactNode[] = [];

  // «شروع کردم» (in_progress) is hidden with the «در جریان» tab (owner decision); an assignee only marks «انجام شد».
  if (canUpdate && isAssignee && !closed && myAssigneeState !== "done") {
    buttons.push(
      <Button key="done" className={buttonClass} disabled={pending} onClick={() => run("انجام شد", () => changeStatusAction({ workItemId, toStatusCode: "done" }))}>
        <Check aria-hidden />
        انجام شد
      </Button>,
    );
  }
  if (manager && closed) {
    buttons.push(
      <Button key="reopen" variant="outline" className={buttonClass} disabled={pending} onClick={() => run("بازگشایی شد", () => changeStatusAction({ workItemId, toStatusCode: "open" }))}>
        <RotateCcw aria-hidden />
        بازگشایی
      </Button>,
    );
  }
  if (manager && !closed) {
    // A creator who is also the (only) assignee already has «انجام شد» above — «اتمام» would be the same click twice.
    if (!isAssignee) {
      buttons.push(
        <Button key="finish" className={buttonClass} disabled={pending} onClick={() => setConfirm("done")}>
          <CheckCheck aria-hidden />
          اتمام
        </Button>,
      );
    }
    buttons.push(
      <Button key="extend" variant="outline" className={buttonClass} disabled={pending} onClick={() => setExtending(true)}>
        <CalendarPlus aria-hidden />
        تمدید
      </Button>,
      <Button key="cancel" variant="ghost" className={cn(buttonClass, "text-danger hover:bg-danger-soft hover:text-danger")} disabled={pending} onClick={() => setConfirm("cancel")}>
        <Trash2 aria-hidden />
        حذف
      </Button>,
    );
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      {buttons}

      {/* «اتمام» — closes the item for everyone: the creator-authoritative `done` transition. */}
      <ResponsiveModal
        open={confirm === "done"}
        onOpenChange={(o) => setConfirm(o ? "done" : null)}
        title={`اتمام ${words.singular}`}
description={assigneeCount > 1 ? `همهٴ ${words.recipients} انجام‌شده ثبت می‌شوند؟ ${words.singular} برای همه بسته می‌شود و بعداً می‌توانید آن را بازگشایی کنید.` : `گیرنده انجام‌شده ثبت می‌شود و ${words.singular} بسته می‌شود. بعداً می‌توانید آن را بازگشایی کنید.`}
      >
        <ConfirmRow
          pending={pending}
          onCancel={() => setConfirm(null)}
          confirm={
            <Button
              type="button"
              className="min-w-28"
              disabled={pending}
              onClick={() => {
                setConfirm(null);
                run(`${words.singular} تمام شد`, () => changeStatusAction({ workItemId, toStatusCode: "done" }));
              }}
            >
              <CheckCheck aria-hidden />
              اتمام {words.singular}
            </Button>
          }
        />
      </ResponsiveModal>

      {/* «حذف» — the same `cancelled` transition as before, under the word the owner asked for. */}
      <ResponsiveModal
        open={confirm === "cancel"}
        onOpenChange={(o) => setConfirm(o ? "cancel" : null)}
        title={`حذف ${words.singular}`}
description={`این ${words.singular} حذف شود؟ ${words.recipients} دیگر آن را در فهرست خود نمی‌بینند. بعداً می‌توانید آن را بازگشایی کنید.`}
      >
        <ConfirmRow
          pending={pending}
          onCancel={() => setConfirm(null)}
          confirm={
            <Button
              type="button"
              variant="destructive"
              className="min-w-28"
              disabled={pending}
              onClick={() => {
                setConfirm(null);
                run(`${words.singular} حذف شد`, () => changeStatusAction({ workItemId, toStatusCode: "cancelled" }));
              }}
            >
              <Trash2 aria-hidden />
              حذف {words.singular}
            </Button>
          }
        />
      </ResponsiveModal>

      <ResponsiveModal open={extending} onOpenChange={setExtending} title="تمدید مهلت" description={`مهلت فعلی: ${dueAt ? formatJalaliDateTime(dueAt) : "بدون مهلت"}`}>
        {extending ? <ExtendForm workItemId={workItemId} title={title} dueAt={dueAt} onClose={() => setExtending(false)} onDone={() => router.refresh()} /> : null}
      </ResponsiveModal>
    </div>
  );
}

function ConfirmRow({ pending, onCancel, confirm }: { pending: boolean; onCancel: () => void; confirm: React.ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
      <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
        انصراف
      </Button>
      {confirm}
    </div>
  );
}

/** The extend dialog's body: the calendar inline (today onward), the time toggle, the new due in one line, submit. */
function ExtendForm({ workItemId, title, dueAt, onClose, onDone }: { workItemId: string; title: string; dueAt: Date | null; onClose: () => void; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Prefill with the current due (day + a specific time when it is not the end of the day) so «one week more» is two taps.
  const [dueDate, setDueDate] = useState(() => {
    if (!dueAt) return "";
    const local = tehranNow(dueAt);
    return local.getTime() >= tehranToday().getTime() ? formatJalaliDay(local) : "";
  });
  const [dueTime, setDueTime] = useState(() => {
    if (!dueAt) return "";
    const local = tehranNow(dueAt);
    const minutes = local.getHours() * 60 + local.getMinutes();
    return minutes === 23 * 60 + 59 ? "" : formatHm(minutes);
  });
  const day = dueDate ? parseJalaliDay(dueDate) : null;
  const instant = dueDate ? parseJalaliToInstant(dueDate, dueTime || null) : null;
  const inPast = instant !== null && instant <= new Date();
  const unchanged = instant !== null && dueAt !== null && instant.getTime() === dueAt.getTime();
  const blocked = pending || !instant || inPast || unchanged;

  const submit = () =>
    start(async () => {
      const r = await extendDueAtAction({ workItemId, dueDate, dueTime: dueTime || undefined });
      if (r.ok) {
        toast.success(`مهلت «${title}» تمدید شد`);
        onClose();
        onDone();
        return;
      }
      setErrors(flatten(r.fieldErrors, r.message, ["dueDate", "dueTime"]));
    });

  return (
    <div className="flex flex-col gap-4 pt-2">
      {/* The dialog itself is the «مهلت» panel — a card inside it would be a card inside a card. Just the rule. */}
      <JalaliDatePicker variant="inline" value={dueDate} onChange={setDueDate} minDate={tehranToday()} />
      {day ? (
        <>
          <hr className="border-line" />
          <TimePicker value={dueTime} onChange={setDueTime} />
        </>
      ) : null}
      <p role="status" className={cn("min-h-6 text-sm leading-6", inPast || unchanged ? "text-warning-text" : "text-text-muted")}>
        {day ? (
          <>
            {inPast ? "این زمان گذشته است: " : unchanged ? "همان مهلت فعلی است: " : "مهلت جدید: "}
            <span className="tabular text-text">
              {formatJalaliDayLong(day)}، ساعت {formatTimeFa(dueTime)}
            </span>
          </>
        ) : (
          "روز مهلت جدید را از تقویم انتخاب کنید."
        )}
      </p>
      <p role="alert" className={cn("text-sm text-danger", !(errors.dueDate || errors.dueTime || errors.form) && "hidden")}>
        {errors.dueDate ?? errors.dueTime ?? errors.form}
      </p>
      <ConfirmRow
        pending={pending}
        onCancel={onClose}
        confirm={
          <Button type="button" className="min-w-32" disabled={blocked} onClick={submit}>
            <CalendarPlus aria-hidden />
            {pending ? "در حال تمدید…" : "تمدید مهلت"}
          </Button>
        }
      />
    </div>
  );
}
