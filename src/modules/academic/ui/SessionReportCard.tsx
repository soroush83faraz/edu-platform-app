"use client";

import { BookOpenText, Check, Eraser, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { PageSection } from "@/components/layout/PageSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import { Textarea } from "@/components/ui/textarea";
import { flatten } from "@/lib/form-errors";
import { formatNumberFa } from "@/lib/format";
import { SESSION_REPORT_LIMITS } from "@/lib/session-report";
import { clearSessionReportAction, saveSessionReportAction } from "../actions";
import type { SessionReportCell } from "../session-report";

const FIELDS = ["topic", "pageRef", "workItemId", "privateNote", "nextPlan"];

/** A field's live counter «۱۲ از ۲۰۰» — neutral text, danger only when the limit is hit. */
function Counter({ n, max }: { n: number; max: number }) {
  return (
    <span className={cn("tabular text-meta", n >= max ? "text-danger" : "text-text-faint")} aria-hidden>
      {formatNumberFa(n)} از {formatNumberFa(max)}
    </span>
  );
}

/**
 * «گزارش جلسه» under the roll call (دفتر کلاسی): what was taught («موضوع تدریس‌شده», the one required field), the
 * page / chapter, the تکلیف given in this session (a choice among the تکلیف of this درس), the دبیر's PRIVATE note (staff
 * only — never shown to students) and the plan for the next session. One report per session: a second save updates it;
 * «پاک‌کردن» withdraws it. Rendered only for someone who may write it (the page asks `sessionReportCellQuery`); the
 * service re-checks the scope on every save.
 */
export function SessionReportCard({
  classGroupId,
  date,
  periodNo,
  cell,
}: {
  classGroupId: string;
  date: string;
  periodNo: number;
  cell: SessionReportCell;
}) {
  const ids = useId();
  const router = useRouter();
  const [pending, start] = useTransition();
  const saved = cell.report;
  const [topic, setTopic] = useState(saved?.topic ?? "");
  const [pageRef, setPageRef] = useState(saved?.pageRef ?? "");
  const [workItemId, setWorkItemId] = useState(saved?.workItem?.id ?? "");
  const [privateNote, setPrivateNote] = useState(saved?.privateNote ?? "");
  const [nextPlan, setNextPlan] = useState(saved?.nextPlan ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});

  // A linked تکلیف that is no longer in the choices (closed since) stays selectable so saving does not silently drop it.
  const choices = [...cell.workItems];
  if (saved?.workItem && !choices.some((w) => w.id === saved.workItem?.id)) choices.unshift({ id: saved.workItem.id, title: saved.workItem.title || "تکلیف پیشین این جلسه" });

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    if (topic.trim() === "") {
      setErrors({ topic: "موضوع تدریس‌شده را بنویسید." });
      return;
    }
    start(async () => {
      const r = await saveSessionReportAction({
        classGroupId,
        date,
        periodNo,
        topic: topic.trim(),
        pageRef: pageRef.trim() === "" ? null : pageRef.trim(),
        workItemId: workItemId === "" ? null : workItemId,
        privateNote: privateNote.trim() === "" ? null : privateNote.trim(),
        nextPlan: nextPlan.trim() === "" ? null : nextPlan.trim(),
      });
      if (r.ok) {
        setErrors({});
        toast.success(r.data.created ? "گزارش جلسه ثبت شد" : "گزارش جلسه به‌روز شد");
        router.refresh();
        return;
      }
      setErrors(flatten(r.fieldErrors, r.message, FIELDS));
    });
  };

  const clear = () => {
    if (pending) return;
    start(async () => {
      const r = await clearSessionReportAction({ classGroupId, date, periodNo });
      if (r.ok) {
        setTopic("");
        setPageRef("");
        setWorkItemId("");
        setPrivateNote("");
        setNextPlan("");
        setErrors({});
        toast.success("گزارش جلسه پاک شد");
        router.refresh();
        return;
      }
      setErrors({ form: r.message });
    });
  };

  const err = (name: string) => (
    <p id={`${ids}-${name}-err`} role="alert" className={cn("text-sm text-danger", !errors[name] && "hidden")}>
      {errors[name]}
    </p>
  );

  return (
    <PageSection id="session-report" title="گزارش جلسه" icon={BookOpenText} surface="work" trailing={saved ? <span className="text-meta text-success">ثبت‌شده</span> : undefined}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={`${ids}-topic`}>موضوع تدریس‌شده</Label>
            <Counter n={topic.length} max={SESSION_REPORT_LIMITS.topic} />
          </div>
          <Input
            id={`${ids}-topic`}
            dir="auto"
            value={topic}
            maxLength={SESSION_REPORT_LIMITS.topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="مثلاً: ضرب کسرها با مخرج‌های متفاوت"
            aria-invalid={errors.topic ? true : undefined}
            aria-describedby={errors.topic ? `${ids}-topic-err` : undefined}
          />
          {err("topic")}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-pageRef`}>صفحه یا فصل (اختیاری)</Label>
            <Input
              id={`${ids}-pageRef`}
              dir="auto"
              value={pageRef}
              maxLength={SESSION_REPORT_LIMITS.pageRef}
              onChange={(e) => setPageRef(e.target.value)}
              placeholder="مثلاً: فصل ۳، صفحه‌های ۴۲ تا ۴۶"
              aria-invalid={errors.pageRef ? true : undefined}
              aria-describedby={errors.pageRef ? `${ids}-pageRef-err` : undefined}
            />
            {err("pageRef")}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-workItemId`}>تکلیف این جلسه (اختیاری)</Label>
            <SelectNative
              id={`${ids}-workItemId`}
              value={workItemId}
              onChange={(e) => setWorkItemId(e.target.value)}
              aria-invalid={errors.workItemId ? true : undefined}
              aria-describedby={errors.workItemId ? `${ids}-workItemId-err` : undefined}
            >
              <option value="">بدون تکلیف</option>
              {choices.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.title}
                </option>
              ))}
            </SelectNative>
            {err("workItemId")}
            {choices.length === 0 ? <p className="text-meta text-text-muted">برای این درس هنوز تکلیفی نداده‌اید.</p> : null}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={`${ids}-nextPlan`}>برنامهٴ جلسهٴ بعد (اختیاری)</Label>
            <Counter n={nextPlan.length} max={SESSION_REPORT_LIMITS.nextPlan} />
          </div>
          <Textarea
            id={`${ids}-nextPlan`}
            dir="auto"
            rows={2}
            value={nextPlan}
            maxLength={SESSION_REPORT_LIMITS.nextPlan}
            onChange={(e) => setNextPlan(e.target.value)}
            placeholder="دانش‌آموزان برای جلسهٴ بعد چه چیزی بخوانند یا بیاورند؟"
            className="min-h-20"
            aria-invalid={errors.nextPlan ? true : undefined}
            aria-describedby={errors.nextPlan ? `${ids}-nextPlan-err` : undefined}
          />
          {err("nextPlan")}
        </div>

        <div className="flex flex-col gap-1.5 rounded-card bg-surface-sunken p-3">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={`${ids}-privateNote`}>
              <Lock className="size-4 text-text-muted" aria-hidden />
              یادداشت دبیر (اختیاری)
            </Label>
            <Counter n={privateNote.length} max={SESSION_REPORT_LIMITS.privateNote} />
          </div>
          <Textarea
            id={`${ids}-privateNote`}
            dir="auto"
            rows={3}
            value={privateNote}
            maxLength={SESSION_REPORT_LIMITS.privateNote}
            onChange={(e) => setPrivateNote(e.target.value)}
            placeholder="مشاهده‌ها و نکته‌های کلاس، برای خودتان"
            className="bg-surface"
            aria-invalid={errors.privateNote ? true : undefined}
            aria-describedby={`${ids}-privateNote-hint${errors.privateNote ? ` ${ids}-privateNote-err` : ""}`}
          />
          <p id={`${ids}-privateNote-hint`} className="text-meta text-text-muted">
            فقط شما و مدیران مدرسه می‌بینید؛ دانش‌آموزان و اولیا نه.
          </p>
          {err("privateNote")}
        </div>

        <p role="alert" className={cn("text-sm text-danger", !errors.form && "hidden")}>
          {errors.form}
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          {saved ? (
            <Button type="button" variant="ghost" onClick={clear} disabled={pending} className="w-full sm:w-auto">
              <Eraser aria-hidden />
              پاک‌کردن گزارش
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" disabled={pending} className="w-full sm:w-auto">
            <Check aria-hidden />
            {pending ? "در حال ثبت…" : saved ? "ذخیرهٴ تغییرات" : "ثبت گزارش جلسه"}
          </Button>
        </div>
      </form>
    </PageSection>
  );
}
