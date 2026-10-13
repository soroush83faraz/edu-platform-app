"use client";

import { Send, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { flatten } from "@/lib/form-errors";
import { ResponsiveModal } from "@/components/admin/ResponsiveModal";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { archiveTeacherReportAction, createTeacherReportAction } from "../actions";
import { REPORT_KIND_LABELS, REPORT_KINDS, REPORT_MAX, type ReportKind } from "../policy";

/**
 * «گزارش به مشاور» — a teacher of the student writes a short درسی / رفتاری report for the school's counselors (and
 * its management). It is not a conversation: the counselor reads it in the student's file; the teacher sees only
 * their own reports on this page.
 */
export function TeacherReportForm({ studentProfileId }: { studentProfileId: string }) {
  const ids = useId();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<ReportKind>("academic");
  const [body, setBody] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending || body.trim() === "") return;
    start(async () => {
      const r = await createTeacherReportAction({ studentProfileId, kind, body: body.trim() });
      if (r.ok) {
        toast.success("گزارش برای مشاور فرستاده شد");
        setBody("");
        setErrors({});
        router.refresh();
        return;
      }
      setErrors(flatten(r.fieldErrors, r.message, ["kind", "body"]));
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-medium text-text">نوع گزارش</legend>
        <div role="radiogroup" className="grid grid-cols-2 gap-1 rounded-xl bg-surface-sunken p-1">
          {REPORT_KINDS.map((k) => {
            const on = kind === k;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setKind(k)}
                className={cn("pressable min-h-11 rounded-lg px-3 text-sm font-medium transition-colors", on ? "bg-surface text-primary-800 shadow-1" : "text-text-muted hover:bg-surface")}
              >
                {REPORT_KIND_LABELS[k]}
              </button>
            );
          })}
        </div>
      </fieldset>
      <Label htmlFor={`${ids}-body`}>متن گزارش</Label>
      <Textarea
        id={`${ids}-body`}
        dir="auto"
        rows={5}
        maxLength={REPORT_MAX}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-invalid={errors.body ? true : undefined}
        aria-describedby={errors.body ? `${ids}-body-err` : undefined}
      />
      <p id={`${ids}-body-err`} role="alert" className={cn("text-sm text-danger", !errors.body && "hidden")}>
        {errors.body}
      </p>
      <p role="alert" className={cn("text-sm text-danger", !errors.form && "hidden")}>
        {errors.form}
      </p>
      <div className="flex justify-end">
        <Button type="submit" className="w-full sm:w-auto" disabled={pending || body.trim() === ""}>
          <Send aria-hidden className="rtl:-scale-x-100" />
          {pending ? "در حال ارسال…" : "ارسال گزارش"}
        </Button>
      </div>
    </form>
  );
}

/** «حذف» of the teacher's own report (soft: it leaves the file; the record stays in the system). */
export function WithdrawReportButton({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const withdraw = () =>
    start(async () => {
      const r = await archiveTeacherReportAction({ reportId });
      if (r.ok) {
        toast.success("گزارش حذف شد");
        setOpen(false);
        router.refresh();
      } else toast.error(r.message);
    });
  return (
    <>
      <Button type="button" variant="ghost" size="sm" className="min-h-11 text-text-muted" disabled={pending} onClick={() => setOpen(true)}>
        <Trash2 aria-hidden />
        حذف
      </Button>
      <ResponsiveModal open={open} onOpenChange={setOpen} title="حذف گزارش" description="گزارش از پروندهٴ مشاوره برداشته می‌شود.">
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            انصراف
          </Button>
          <Button type="button" variant="destructive" className="min-w-28" onClick={withdraw} disabled={pending}>
            <Trash2 aria-hidden />
            حذف گزارش
          </Button>
        </div>
      </ResponsiveModal>
    </>
  );
}
