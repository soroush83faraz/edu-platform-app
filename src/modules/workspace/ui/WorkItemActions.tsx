"use client";

import { Check, CheckCheck, Pencil, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { ResponsiveModal } from "@/components/admin/ResponsiveModal";
import { prefersReducedMotion } from "@/components/motion/CrossFade";
import { DrawnCheck } from "@/components/motion/DrawnCheck";
import { JalaliDatePicker } from "@/components/pickers/JalaliDatePicker";
import { TimePicker, formatTimeFa } from "@/components/pickers/TimePicker";
import { PrioritySelect } from "@/components/PrioritySelect";
import type { Priority } from "@/components/priority";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { forgetCompleted, noteCompleted } from "@/lib/completion-moment";
import { flatten } from "@/lib/form-errors";
import { parseJalaliToInstant, tehranNow } from "@/lib/format";
import { formatHm, formatJalaliDay, formatJalaliDayLong, parseJalaliDay, tehranToday } from "@/lib/jalali-grid";
import type { WorkItemWords } from "@/lib/work-item-words";
import { changeStatusAction, markInboxReadAction, updateWorkItemAction } from "../actions";
import type { StatusCategory } from "../repo";
import { useCompletion } from "./Completion";

/** What the «ویرایش» form starts from — the item as it is now. */
export interface EditableItem {
  title: string;
  description: string | null;
  priority: Priority;
  dueAt: Date | null;
}

export interface WorkItemActionsProps extends EditableItem {
  workItemId: string;
  statusCategory: StatusCategory;
  assigneeCount: number;
  myAssigneeState: "pending" | "accepted" | "done" | null;
  /**
   * `viewer.isManager` of the detail read model (`managesItem`, ../manage-policy): the creator, or a broad admin who is
   * NOT one of the assignees. A principal given a تسک by the organization admin is false here — an assignee.
   */
  isManager: boolean;
  canUpdate: boolean;
  /** My inbox row's state, or `null` when I have none — the only thing left of the personal entry in this row. */
  inboxState: string | null;
  /** The reader's noun set: «تکلیف» for a teacher, «تسک» for مدیر/معاون (src/lib/work-item-words). */
  words: WorkItemWords;
  /** THIS item's name for the reader — `words.singular`, or a personal item's «تسک» / catalog name (`personalItemLabel`). */
  noun: string;
}

/**
 * The action row of a کار — named «تکلیف» or «تسک» by the reader's hats. An assignee gets «انجام شد» — also an
 * assignee who holds a broad admin hat (a principal given a تسک by the organization admin): their «انجام شد» marks
 * only their own row. The item's manager (`isManager`: its creator, or a broad admin who is not one of its
 * assignees) gets the three creator actions — «اتمام» (primary: closes it for everyone), «ویرایش»
 * (secondary: title, description, priority and deadline — earlier, later or none), «حذف» (ghost, red) — or, once it is closed, «بازیابی» (outline) and, on a
 * finished one, «حذف» beside it (destructive tint; owner, round 7). «حذف» is a LABEL: the stored status is still
 * `cancelled`, nothing leaves the database and «بازیابی» brings the item back (owner, round 4); after it the reader
 * goes back to the list. Who sees «حذف» is exactly who may cancel — the creator (a student only on their own
 * «تسک») or a broad `update` holder who is not an assignee; the service enforces the same rule (`managesItem`).
 * There is no overflow menu: سنجاق / بایگانی left the UI (owner, round 5 — «if the teacher wants, they can delete
 * it»); `setPinned` / `archiveInbox` stay in the service, unwired. Full-width and stacked on phones, one inline row
 * from `sm:`, every target 44 px. Marks my inbox row read once on mount.
 *
 * Finishing is answered at once (optimistic, docs/decisions «حرکت در پاسخ به کار کاربر»): the title is struck
 * (`CompletionProvider`), «انجام شد» turns into its quiet outline twin whose check draws itself, and once the
 * server agrees that button folds away (`FoldAway`) — the header's «انجام‌شده» line says it from then on. A
 * refusal un-strikes the title and brings the button back. The finish is noted for the کارتابل and Home
 * (`src/lib/completion-moment.ts`).
 */
export function WorkItemActions({ workItemId, title, description, priority, statusCategory, dueAt, assigneeCount, myAssigneeState, isManager, canUpdate, inboxState, words, noun }: WorkItemActionsProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // `"cancel"` is the `cancelled` transition — the button that used to read «کنسل» and now reads «حذف».
  const [confirm, setConfirm] = useState<"done" | "cancel" | null>(null);
  const [editing, setEditing] = useState(false);
  const markDone = useCompletion();
  // «انجام شد» was tapped on this page view: the button stays (as its finished twin) until it folds away.
  const [justDone, setJustDone] = useState(false);

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

  /** «انجام شد» / «اتمام»: strike now, ask the server, undo the strike if it refuses. */
  const finish = (label: string) => {
    setJustDone(true);
    markDone?.(true);
    noteCompleted(workItemId, dueAt);
    start(async () => {
      const r = await changeStatusAction({ workItemId, toStatusCode: "done" });
      if (r.ok) {
        toast.success(label);
        router.refresh();
      } else {
        setJustDone(false);
        markDone?.(false);
        forgetCompleted(workItemId);
        toast.error(r.message ?? "خطایی رخ داد.");
      }
    });
  };

  /** «حذف»: the `cancelled` transition, then back to the list — the item is gone from the reader's work. */
  const remove = () =>
    start(async () => {
      const r = await changeStatusAction({ workItemId, toStatusCode: "cancelled" });
      if (r.ok) {
        toast.success(`${noun} حذف شد`);
        router.push("/inbox");
      } else toast.error(r.message ?? "خطایی رخ داد.");
    });

  const closed = statusCategory === "done" || statusCategory === "cancelled";
  const isAssignee = myAssigneeState !== null;
  const manager = canUpdate && isManager;
  const buttonClass = "w-full sm:w-auto";
  const buttons: React.ReactNode[] = [];

  // «شروع کردم» (in_progress) is hidden with the «در جریان» tab (owner decision); an assignee only marks «انجام شد».
  const canFinishMine = canUpdate && isAssignee && !closed && myAssigneeState !== "done";
  if (canFinishMine || (justDone && isAssignee)) {
    const button = (
      // The finished twin is inert but not faded (`disabled` would halve it): the drawn check must read clearly.
      <Button
        key="done"
        variant={justDone ? "outline" : "default"}
        className={cn(buttonClass, justDone && "pointer-events-none")}
        disabled={pending && !justDone}
        aria-disabled={justDone || undefined}
        onClick={() => {
          if (!justDone) finish("انجام شد");
        }}
      >
        {justDone ? <DrawnCheck className="text-success" /> : <Check aria-hidden />}
        انجام شد
      </Button>
    );
    // Once the server says «done», the finished twin holds for a beat and folds away. Always wrapped, so the
    // button is not remounted (its check would draw twice) when the server's answer arrives.
    buttons.push(
      <FoldAway key="done" folding={!canFinishMine} onGone={() => setJustDone(false)}>
        {button}
      </FoldAway>,
    );
  }
  if (manager && closed) {
    buttons.push(
      <Button
        key="reopen"
        variant="outline"
        className={buttonClass}
        disabled={pending}
        onClick={() => {
          setJustDone(false);
          markDone?.(false);
          run(`${noun} بازیابی شد`, () => changeStatusAction({ workItemId, toStatusCode: "open" }));
        }}
      >
        <RotateCcw aria-hidden />
        بازیابی
      </Button>,
    );
    // A finished item can also be removed; an already removed one only comes back.
    if (statusCategory === "done") {
      buttons.push(
        <Button key="remove" variant="destructive" className={buttonClass} disabled={pending} onClick={() => setConfirm("cancel")}>
          <Trash2 aria-hidden />
          حذف
        </Button>,
      );
    }
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
      <Button key="edit" variant="outline" className={buttonClass} disabled={pending} onClick={() => setEditing(true)}>
        <Pencil aria-hidden />
        ویرایش
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
        title={`اتمام ${noun}`}
        description={assigneeCount > 1 ? `همهٴ ${words.recipients} انجام‌شده ثبت می‌شوند؟ ${noun} برای همه بسته می‌شود و بعداً می‌توانید آن را بازیابی کنید.` : `گیرنده انجام‌شده ثبت می‌شود و ${noun} بسته می‌شود. بعداً می‌توانید آن را بازیابی کنید.`}
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
                finish(`${noun} تمام شد`);
              }}
            >
              <CheckCheck aria-hidden />
              اتمام {noun}
            </Button>
          }
        />
      </ResponsiveModal>

      {/* «حذف» — the `cancelled` transition (open or finished), under the word the owner asked for. */}
      <ResponsiveModal
        open={confirm === "cancel"}
        onOpenChange={(o) => setConfirm(o ? "cancel" : null)}
        title={`حذف ${noun}`}
        description={`این ${noun} حذف شود؟ بعداً می‌توانید آن را بازیابی کنید.`}
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
                remove();
              }}
            >
              <Trash2 aria-hidden />
              حذف {noun}
            </Button>
          }
        />
      </ResponsiveModal>

      <ResponsiveModal open={editing} onOpenChange={setEditing} title={`ویرایش ${noun}`}>
        {editing ? <EditForm workItemId={workItemId} item={{ title, description, priority, dueAt }} noun={noun} onClose={() => setEditing(false)} onDone={() => router.refresh()} /> : null}
      </ResponsiveModal>
    </div>
  );
}

/**
 * While `folding`, holds a finished control for a beat (900 ms), then folds it away — height to zero and fades, 250 ms — instead of
 * letting it vanish in one frame. Under reduced motion it simply goes after the beat.
 */
function FoldAway({ folding, children, onGone }: { folding: boolean; children: React.ReactNode; onGone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const gone = useRef(onGone);
  useEffect(() => {
    gone.current = onGone;
  });
  useEffect(() => {
    if (!folding) return;
    let animation: Animation | undefined;
    const timer = window.setTimeout(() => {
      const el = ref.current;
      if (!el || typeof el.animate !== "function" || prefersReducedMotion()) return gone.current();
      el.style.overflow = "hidden";
      animation = el.animate([{ height: `${el.offsetHeight}px`, minHeight: "0px", opacity: 1 }, { height: "0px", minHeight: "0px", opacity: 0 }], { duration: 250, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards" });
      animation.finished.then(
        () => gone.current(),
        () => undefined,
      );
    }, 900);
    return () => {
      window.clearTimeout(timer);
      animation?.cancel();
    };
  }, [folding]);
  return (
    <div ref={ref} className="flex flex-col sm:block">
      {children}
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

/**
 * The «ویرایش» dialog's body: the create form's fields (title, description, the «مهلت» date + time, priority)
 * prefilled with the item as it is. The deadline is sent only once it was touched, so an overdue item can have its
 * typo fixed without being asked for a new date; a CHANGED deadline must lie ahead (earlier or later — both fine) or
 * be removed with the field's ×. «ذخیرهٴ تغییرات» waits until something differs.
 */
function EditForm({ workItemId, item, noun, onClose, onDone }: { workItemId: string; item: EditableItem; noun: string; onClose: () => void; onDone: () => void }) {
  const ids = useId();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? "");
  const [priority, setPriority] = useState<Priority>(item.priority);
  // The current due as the pickers' strings — also when it is already behind us (it stays until it is changed).
  const [dueDate, setDueDate] = useState(() => (item.dueAt ? formatJalaliDay(tehranNow(item.dueAt)) : ""));
  const [dueTime, setDueTime] = useState(() => {
    if (!item.dueAt) return "";
    const local = tehranNow(item.dueAt);
    const minutes = local.getHours() * 60 + local.getMinutes();
    return minutes === 23 * 60 + 59 ? "" : formatHm(minutes);
  });
  const [dueTouched, setDueTouched] = useState(false);

  const day = dueDate ? parseJalaliDay(dueDate) : null;
  const instant = dueDate ? parseJalaliToInstant(dueDate, dueTime || null) : null;
  const dueChanged = dueTouched && (instant?.getTime() ?? null) !== (item.dueAt?.getTime() ?? null);
  const inPast = dueChanged && instant !== null && instant <= new Date();
  const dirty = title.trim() !== item.title || description.trim() !== (item.description ?? "") || priority !== item.priority || dueChanged;
  const blocked = pending || !dirty || title.trim() === "" || inPast || (dueChanged && dueDate !== "" && !instant);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (blocked) return;
    start(async () => {
      const r = await updateWorkItemAction({
        workItemId,
        title: title.trim(),
        description: description.trim(),
        priority,
        // Only a touched deadline travels: "" removes it, anything else is the new day (+ time).
        ...(dueChanged ? { dueDate, dueTime: dueDate ? dueTime || undefined : undefined } : {}),
      });
      if (r.ok) {
        toast.success(r.data.changed.length > 0 ? `تغییرات ${noun} ذخیره شد` : "تغییری برای ذخیره نبود");
        onClose();
        onDone();
        return;
      }
      setErrors(flatten(r.fieldErrors, r.message, EDIT_FIELDS));
    });
  };

  const field = (name: string) => ({ id: `${ids}-${name}`, error: errors[name], describedBy: errors[name] ? `${ids}-${name}-err` : undefined });
  const titleF = field("title");
  const descF = field("description");
  const dueF = field("dueDate");
  const timeF = field("dueTime");

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5 pt-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={titleF.id}>عنوان</Label>
        <Input
          id={titleF.id}
          dir="auto"
          maxLength={200}
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={titleF.error || title.trim() === "" ? true : undefined}
          aria-describedby={titleF.describedBy}
        />
        <FieldError id={`${titleF.id}-err`} text={titleF.error ?? (title.trim() === "" ? "عنوان را وارد کنید." : undefined)} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={descF.id}>
          توضیح <span className="text-text-faint">(اختیاری)</span>
        </Label>
        <Textarea
          id={descF.id}
          dir="auto"
          rows={3}
          maxLength={4000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-invalid={descF.error ? true : undefined}
          aria-describedby={descF.describedBy}
        />
        <FieldError id={`${descF.id}-err`} text={descF.error} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={dueF.id}>
          مهلت <span className="text-text-faint">(اختیاری)</span>
        </Label>
        {/* The dialog is the panel — no card inside it; the clock sits under the day once a day exists. */}
        <JalaliDatePicker
          id={dueF.id}
          modal
          value={dueDate}
          minDate={tehranToday()}
          onChange={(v) => {
            setDueDate(v);
            if (!v) setDueTime("");
            setDueTouched(true);
          }}
          aria-invalid={dueF.error ? true : undefined}
          aria-describedby={dueF.describedBy}
        />
        {day ? (
          <TimePicker
            value={dueTime}
            onChange={(v) => {
              setDueTime(v);
              setDueTouched(true);
            }}
            aria-describedby={timeF.describedBy}
          />
        ) : null}
        <FieldError id={`${dueF.id}-err`} text={dueF.error} />
        <FieldError id={`${timeF.id}-err`} text={timeF.error} />
        <p role="status" className={cn("flex items-center gap-1.5 text-sm leading-6", inPast ? "text-warning-text" : "text-text-muted")}>
          {inPast ? <TriangleAlert className="size-4 shrink-0" aria-hidden /> : null}
          {day ? (
            <>
              {inPast ? "این زمان گذشته است: " : dueChanged ? "مهلت جدید: " : "مهلت: "}
              <span className="tabular text-text">
                {formatJalaliDayLong(day)}، ساعت {formatTimeFa(dueTime)}
              </span>
            </>
          ) : dueChanged ? (
            "مهلت برداشته می‌شود."
          ) : (
            "بدون مهلت"
          )}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <span id={`${ids}-priority`} className="text-sm font-medium text-text">
          اولویت
        </span>
        <PrioritySelect modal value={priority} onChange={setPriority} aria-labelledby={`${ids}-priority`} />
      </div>

      <p role="alert" className={cn("text-sm text-danger", !errors.form && "hidden")}>
        {errors.form}
      </p>
      <ConfirmRow
        pending={pending}
        onCancel={onClose}
        confirm={
          <Button type="submit" className="min-w-32" disabled={blocked}>
            <Check aria-hidden />
            {pending ? "در حال ذخیره…" : "ذخیرهٴ تغییرات"}
          </Button>
        }
      />
    </form>
  );
}

/** Every field the edit form renders; a server error on anything else lands on the form-level line. */
const EDIT_FIELDS = ["title", "description", "priority", "dueDate", "dueTime"];

function FieldError({ id, text }: { id: string; text?: string }) {
  return (
    <p id={id} role="alert" className={cn("text-sm text-danger", !text && "hidden")}>
      {text}
    </p>
  );
}
