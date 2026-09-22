"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatNumberFa, toFaDigits } from "@/lib/format";
import { toAsciiDigits } from "@/lib/normalize";
import { MAX_PERIODS, periodLabel, timeToMinutes, validatePeriods, type PeriodInput } from "@/lib/timetable";
import { setSchoolPeriodsAction } from "../actions";

/**
 * The bell schedule («زنگ‌بندی») editor: one row per زنگ — name, start, end — «زنگ جدید» appends the next one
 * ten minutes after the last, «حذف» removes the last row only (numbers stay 1..n), and the primary action sends
 * the whole list. Validation (order, overlap, ≤ 12) runs on the client first with the same rule as the service.
 *
 * The primary action is ALWAYS enabled (QA round 3): a new school is seeded with the six default زنگ‌ها, and the
 * operator whose day already matches them must be able to say so — «تأیید زنگ‌بندی» when nothing was touched,
 * «ذخیرهٴ زنگ‌بندی» once a row changed. Both post the same rows through the same action; `dirty` only picks the
 * word (before, it also disabled the button, so the defaults could not be confirmed at all).
 */
export function PeriodsEditor({ schoolId, initial, canEdit }: { schoolId: string; initial: PeriodInput[]; canEdit: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<PeriodInput[]>(() => initial.map((p) => ({ periodNo: p.periodNo, label: p.label, startsAt: p.startsAt, endsAt: p.endsAt })));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(rows) !== JSON.stringify(initial.map((p) => ({ periodNo: p.periodNo, label: p.label, startsAt: p.startsAt, endsAt: p.endsAt })));

  const update = (i: number, patch: Partial<PeriodInput>) => setRows((r) => r.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const add = () => {
    setRows((r) => {
      const last = r.at(-1);
      const n = r.length + 1;
      const startMin = last ? timeToMinutes(toAsciiDigits(last.endsAt)) + 10 : 8 * 60;
      const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      const s = Number.isNaN(startMin) ? "08:00" : hhmm(startMin);
      const e = Number.isNaN(startMin) ? "08:45" : hhmm(startMin + 45);
      return [...r, { periodNo: n, label: periodLabel(n), startsAt: s, endsAt: e }];
    });
  };
  const removeLast = () => setRows((r) => r.slice(0, -1));

  const save = () => {
    // Explicit fields: the action's schema is strict and the rows may carry the row id from the query.
    const cleaned: PeriodInput[] = rows.map((p) => ({ periodNo: p.periodNo, label: p.label.trim(), startsAt: toAsciiDigits(p.startsAt.trim()), endsAt: toAsciiDigits(p.endsAt.trim()) }));
    const problem = validatePeriods(cleaned);
    setError(problem);
    if (problem) return;
    start(async () => {
      const r = await setSchoolPeriodsAction({ schoolId, periods: cleaned });
      if (!r.ok) {
        setError(r.fieldErrors?.periods?.[0] ?? r.message);
        return;
      }
      toast.success(`${dirty ? "زنگ‌بندی ذخیره شد" : "زنگ‌بندی تأیید شد"} (${formatNumberFa(r.data.count)} زنگ)`);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {canEdit ? <p className="px-1 text-meta text-text-muted">زنگ‌بندی پیش‌فرض شش زنگ است. اگر با برنامهٴ مدرسه می‌خواند، تأیید کنید؛ وگرنه ساعت‌ها را تغییر دهید یا زنگ اضافه/کم کنید.</p> : null}
      <ol className="flex flex-col divide-y divide-line/70 surface-work">
        {rows.map((p, i) => (
          <li key={p.periodNo} className="grid grid-cols-[2rem_1fr_5.5rem_5.5rem] items-center gap-2 px-3 py-2 sm:grid-cols-[2.5rem_1fr_7rem_7rem]">
            <span className="tabular text-sm text-text-faint">{formatNumberFa(p.periodNo)}</span>
            {/* dir="ltr" on the two time inputs: the same documented exception as phone inputs (CLAUDE.md) — a time is a code, not prose. */}
            <Input value={p.label} onChange={(e) => update(i, { label: e.target.value })} aria-label={`نام زنگ ${formatNumberFa(p.periodNo)}`} disabled={!canEdit} className="h-11" />
            <Input value={toFaDigits(p.startsAt)} onChange={(e) => update(i, { startsAt: e.target.value })} inputMode="numeric" placeholder="۰۸:۰۰" aria-label={`شروع زنگ ${formatNumberFa(p.periodNo)}`} disabled={!canEdit} className="tabular h-11 text-center" />
            <Input value={toFaDigits(p.endsAt)} onChange={(e) => update(i, { endsAt: e.target.value })} inputMode="numeric" placeholder="۰۸:۴۵" aria-label={`پایان زنگ ${formatNumberFa(p.periodNo)}`} disabled={!canEdit} className="tabular h-11 text-center" />
          </li>
        ))}
        {rows.length === 0 ? <li className="px-4 py-6 text-sm text-text-muted">هنوز زنگی تعریف نشده.</li> : null}
      </ol>
      {canEdit ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={add} disabled={rows.length >= MAX_PERIODS}>
              <Plus aria-hidden />
              زنگ جدید
            </Button>
            <Button type="button" variant="ghost" onClick={removeLast} disabled={rows.length === 0} className="text-danger hover:text-danger">
              <Trash2 aria-hidden />
              حذف آخرین زنگ
            </Button>
            <span className="ms-auto text-meta text-text-muted">
              {formatNumberFa(rows.length)} از {formatNumberFa(MAX_PERIODS)} زنگ
            </span>
          </div>
          <p role="alert" className="min-h-5 text-sm text-danger">
            {error}
          </p>
          <Button type="button" size="lg" onClick={save} disabled={pending}>
            {pending ? "در حال ذخیره…" : dirty ? "ذخیرهٴ زنگ‌بندی" : "تأیید زنگ‌بندی"}
          </Button>
        </>
      ) : (
        <p className="px-1 text-meta text-text-muted">زنگ‌بندی را فقط مدیر مدرسه یا مدیر سازمان تغییر می‌دهد.</p>
      )}
    </div>
  );
}
