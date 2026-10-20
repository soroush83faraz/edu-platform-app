"use client";

import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { flatten } from "@/lib/form-errors";
import { formatJalaliDay, parseJalaliDay, tehranToday as tehranTodayDate } from "@/lib/jalali-grid";
import { LEAVE_CATEGORIES, LEAVE_CATEGORY_LABELS, LEAVE_MAX_DAYS, LEAVE_NOTE_MAX, type LeaveCategory } from "@/lib/leave";
import { formatNumberFa } from "@/lib/format";
import { JalaliDatePicker } from "@/components/pickers/JalaliDatePicker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import { Textarea } from "@/components/ui/textarea";
import { requestLeaveAction } from "@/modules/iam/guardian-leave-actions";

export interface LeavePeriodOption {
  periodNo: number;
  label: string;
}

const FIELDS = ["child", "fromDate", "toDate", "fromPeriod", "toPeriod", "category", "note"];

const two = (n: number) => String(n).padStart(2, "0");
/** The picker's wall-clock day → the ISO Gregorian `YYYY-MM-DD` the action takes (the Date is a plain instant: native getters). */
function toIso(day: Date): string {
  return `${day.getFullYear()}-${two(day.getMonth() + 1)}-${two(day.getDate())}`;
}

/**
 * «درخواست مرخصی» of a guardian for ONE child (owner, 2026-10-20): the first and last day (at most 14 days, never
 * before today), for a single day optionally only a part of it («از زنگ … تا زنگ …»), the reason and an optional
 * note. The school decides; the page's list shows the answer. The server checks every bound again — this form only
 * keeps the choices valid (the end day follows the start, the partial day is offered for one day only).
 */
export function LeaveRequestForm({ child, childFirstName, periods }: { child: string; childFirstName: string; periods: LeavePeriodOption[] }) {
  const ids = useId();
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = formatJalaliDay(tehranTodayDate());
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [partial, setPartial] = useState(false);
  const [fromPeriod, setFromPeriod] = useState("");
  const [toPeriod, setToPeriod] = useState("");
  const [category, setCategory] = useState<LeaveCategory | "">("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const from = parseJalaliDay(fromDate);
  const to = parseJalaliDay(toDate);
  const oneDay = from !== null && to !== null && toIso(from) === toIso(to);
  const partialOn = partial && oneDay && periods.length > 0;
  const ready = from !== null && to !== null && category !== "" && (!partialOn || (fromPeriod !== "" && toPeriod !== ""));

  const pickFrom = (v: string) => {
    setFromDate(v);
    const f = parseJalaliDay(v);
    // The end never sits before the start: it follows.
    if (f && (!to || toIso(to) < toIso(f))) setToDate(v);
  };

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending || !ready || !from || !to) return;
    start(async () => {
      const r = await requestLeaveAction({
        child,
        fromDate: toIso(from),
        toDate: toIso(to),
        ...(partialOn ? { fromPeriod, toPeriod } : {}),
        category,
        note: note.trim() === "" ? null : note.trim(),
      });
      if (r.ok) {
        toast.success("درخواست مرخصی ثبت شد");
        setNote("");
        setCategory("");
        setPartial(false);
        setFromPeriod("");
        setToPeriod("");
        setErrors({});
        router.refresh();
        return;
      }
      setErrors(flatten(r.fieldErrors, r.message, FIELDS));
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-from`}>از روز</Label>
          <JalaliDatePicker id={`${ids}-from`} value={fromDate} onChange={pickFrom} minDate={tehranTodayDate()} aria-invalid={errors.fromDate ? true : undefined} />
          <FieldError text={errors.fromDate} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-to`}>تا روز</Label>
          <JalaliDatePicker id={`${ids}-to`} value={toDate} onChange={setToDate} minDate={from ?? tehranTodayDate()} aria-invalid={errors.toDate ? true : undefined} />
          <FieldError text={errors.toDate} />
        </div>
      </div>
      <p className="-mt-2 text-meta text-text-muted">حداکثر {formatNumberFa(LEAVE_MAX_DAYS)} روز و از امروز به بعد.</p>

      {oneDay && periods.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <label className="flex min-h-11 items-center gap-2.5 text-sm text-text">
            <input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} className="size-5 accent-primary-600" />
            فقط بخشی از روز
          </label>
          {partialOn ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${ids}-fp`}>از زنگ</Label>
                <SelectNative id={`${ids}-fp`} value={fromPeriod} onChange={(e) => setFromPeriod(e.target.value)} aria-invalid={errors.fromPeriod ? true : undefined}>
                  <option value="">انتخاب کنید</option>
                  {periods.map((p) => (
                    <option key={p.periodNo} value={p.periodNo}>
                      {p.label}
                    </option>
                  ))}
                </SelectNative>
                <FieldError text={errors.fromPeriod} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${ids}-tp`}>تا زنگ</Label>
                <SelectNative id={`${ids}-tp`} value={toPeriod} onChange={(e) => setToPeriod(e.target.value)} aria-invalid={errors.toPeriod ? true : undefined}>
                  <option value="">انتخاب کنید</option>
                  {periods.map((p) => (
                    <option key={p.periodNo} value={p.periodNo}>
                      {p.label}
                    </option>
                  ))}
                </SelectNative>
                <FieldError text={errors.toPeriod} />
              </div>
            </div>
          ) : null}
        </fieldset>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${ids}-category`}>دلیل</Label>
        <SelectNative id={`${ids}-category`} value={category} onChange={(e) => setCategory(e.target.value as LeaveCategory | "")} aria-invalid={errors.category ? true : undefined}>
          <option value="">انتخاب کنید</option>
          {LEAVE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {LEAVE_CATEGORY_LABELS[c]}
            </option>
          ))}
        </SelectNative>
        <FieldError text={errors.category} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${ids}-note`}>
          توضیح <span className="text-text-faint">(اختیاری)</span>
        </Label>
        <Textarea id={`${ids}-note`} dir="auto" rows={3} maxLength={LEAVE_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} aria-invalid={errors.note ? true : undefined} />
        <FieldError text={errors.note} />
      </div>

      <FieldError text={errors.form ?? errors.child} />
      <div className="flex justify-end">
        <Button type="submit" className="w-full sm:w-auto sm:min-w-44" disabled={pending || !ready}>
          <Send aria-hidden className="rtl:-scale-x-100" />
          {pending ? "در حال ثبت…" : `ثبت درخواست برای ${childFirstName}`}
        </Button>
      </div>
    </form>
  );
}

function FieldError({ text }: { text?: string }) {
  return (
    <p role="alert" className={cn("text-sm text-danger", !text && "hidden")}>
      {text}
    </p>
  );
}
