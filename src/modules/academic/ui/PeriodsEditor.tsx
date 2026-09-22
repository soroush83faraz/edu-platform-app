"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatNumberFa, toFaDigits } from "@/lib/format";
import { toAsciiDigits } from "@/lib/normalize";
import { formatTimeFa, MAX_PERIODS, periodLabel, timeToMinutes, validatePeriods, type PeriodInput } from "@/lib/timetable";
import { setSchoolPeriodsAction } from "../actions";

const same = (a: readonly PeriodInput[], b: readonly PeriodInput[]) =>
  JSON.stringify(a.map(bare)) === JSON.stringify(b.map(bare));
/** The four fields the action takes — the query's rows also carry an id, which never leaves this component. */
const bare = (p: PeriodInput): PeriodInput => ({ periodNo: p.periodNo, label: p.label, startsAt: p.startsAt, endsAt: p.endsAt });

/**
 * The bell schedule («زنگ‌بندی») of one school, in two states on ONE page (owner, QA round 5: «it must open
 * read-only and become editable on demand» — a schedule is read far more often than it is changed, and a screen
 * full of inputs made an unchanged day look like unfinished work).
 *
 * **Read** (the default): زنگ · ساعت شروع · ساعت پایان as plain text, and one primary «ویرایش» — or
 * «تعریف زنگ‌بندی» for a school that has no زنگ at all, the only state where nothing has been confirmed yet.
 * **Edit**: the rows become inputs — «زنگ جدید» appends the next one ten minutes after the last, «حذف آخرین زنگ»
 * removes the last row only (numbers stay 1..n) — with «ذخیرهٴ زنگ‌بندی» and «انصراف», which returns to the read
 * view and drops every change. Validation (order, overlap, ≤ 12) runs on the client first with the same rule as
 * the service, and the primary action is ALWAYS enabled: a new school is seeded with the six default زنگ‌ها, and
 * the operator whose day already matches them must be able to save them unchanged (`tests/int/timetable.test.ts`).
 *
 * Permission is the page's, unchanged: `canEdit` is `tenancy.structure.write` at the school (org admin,
 * principal). A vice principal gets the read view and no «ویرایش» — and therefore no form control at all.
 */
export function PeriodsEditor({ schoolId, initial, canEdit }: { schoolId: string; initial: PeriodInput[]; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<PeriodInput[]>(() => initial.map(bare));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

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

  const open = () => {
    setRows(initial.map(bare));
    setError(null);
    setEditing(true);
  };
  const cancel = () => {
    setRows(initial.map(bare));
    setError(null);
    setEditing(false);
  };

  const save = () => {
    // Explicit fields: the action's schema is strict and the rows may carry the row id from the query.
    const cleaned: PeriodInput[] = rows.map((p) => ({ periodNo: p.periodNo, label: p.label.trim(), startsAt: toAsciiDigits(p.startsAt.trim()), endsAt: toAsciiDigits(p.endsAt.trim()) }));
    const problem = validatePeriods(cleaned);
    setError(problem);
    if (problem) return;
    const unchanged = same(cleaned, initial);
    start(async () => {
      const r = await setSchoolPeriodsAction({ schoolId, periods: cleaned });
      if (!r.ok) {
        setError(r.fieldErrors?.periods?.[0] ?? r.message);
        return;
      }
      toast.success(`${unchanged ? "زنگ‌بندی تأیید شد" : "زنگ‌بندی ذخیره شد"} (${formatNumberFa(r.data.count)} زنگ)`);
      setEditing(false);
      router.refresh();
    });
  };

  if (!editing) {
    return (
      <div className="flex flex-col gap-4">
        {canEdit ? <p className="px-1 text-meta text-text-muted">زنگ‌بندی پیش‌فرض شش زنگ است. برای تغییر ساعت‌ها «ویرایش» را بزنید.</p> : null}
        <div className="surface-work flex flex-col">
          {initial.length > 0 ? (
            <>
              <div className="grid grid-cols-[2rem_1fr_5.5rem_5.5rem] items-center gap-2 border-b border-line/70 px-3 py-2 text-meta text-text-muted sm:grid-cols-[2.5rem_1fr_7rem_7rem]">
                <span aria-hidden />
                <span>زنگ</span>
                <span className="text-center">ساعت شروع</span>
                <span className="text-center">ساعت پایان</span>
              </div>
              <ol className="flex flex-col divide-y divide-line/70">
                {initial.map((p) => (
                  <li key={p.periodNo} className="grid min-h-11 grid-cols-[2rem_1fr_5.5rem_5.5rem] items-center gap-2 px-3 py-2 sm:grid-cols-[2.5rem_1fr_7rem_7rem]">
                    <span className="tabular text-sm text-text-faint">{formatNumberFa(p.periodNo)}</span>
                    <span className="truncate text-row text-text">
                      <bdi>{p.label}</bdi>
                    </span>
                    {/* A time is a code, not prose: `<bdi dir="ltr">` is the documented exception (CLAUDE.md). */}
                    <span className="tabular text-center text-row text-text">
                      <bdi dir="ltr">{formatTimeFa(p.startsAt)}</bdi>
                    </span>
                    <span className="tabular text-center text-row text-text">
                      <bdi dir="ltr">{formatTimeFa(p.endsAt)}</bdi>
                    </span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="px-4 py-6 text-sm text-text-muted">هنوز زنگی تعریف نشده.</p>
          )}
        </div>
        {canEdit ? (
          <Button type="button" size="lg" onClick={open}>
            <Pencil aria-hidden />
            {initial.length > 0 ? "ویرایش" : "تعریف زنگ‌بندی"}
          </Button>
        ) : (
          <p className="px-1 text-meta text-text-muted">زنگ‌بندی را فقط مدیر مدرسه یا مدیر سازمان تغییر می‌دهد.</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="px-1 text-meta text-text-muted">ساعت‌ها را تغییر دهید یا زنگ اضافه/کم کنید؛ «انصراف» تغییرها را دور می‌ریزد.</p>
      <ol className="flex flex-col divide-y divide-line/70 surface-work">
        {rows.map((p, i) => (
          <li key={p.periodNo} className="grid grid-cols-[2rem_1fr_5.5rem_5.5rem] items-center gap-2 px-3 py-2 sm:grid-cols-[2.5rem_1fr_7rem_7rem]">
            <span className="tabular text-sm text-text-faint">{formatNumberFa(p.periodNo)}</span>
            {/* dir="ltr" on the two time inputs: the same documented exception as phone inputs (CLAUDE.md) — a time is a code, not prose. */}
            <Input value={p.label} onChange={(e) => update(i, { label: e.target.value })} aria-label={`نام زنگ ${formatNumberFa(p.periodNo)}`} className="h-11" />
            <Input value={toFaDigits(p.startsAt)} onChange={(e) => update(i, { startsAt: e.target.value })} inputMode="numeric" placeholder="۰۸:۰۰" aria-label={`شروع زنگ ${formatNumberFa(p.periodNo)}`} className="tabular h-11 text-center" />
            <Input value={toFaDigits(p.endsAt)} onChange={(e) => update(i, { endsAt: e.target.value })} inputMode="numeric" placeholder="۰۸:۴۵" aria-label={`پایان زنگ ${formatNumberFa(p.periodNo)}`} className="tabular h-11 text-center" />
          </li>
        ))}
        {rows.length === 0 ? <li className="px-4 py-6 text-sm text-text-muted">هنوز زنگی تعریف نشده.</li> : null}
      </ol>
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
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="lg" onClick={save} disabled={pending}>
          {pending ? "در حال ذخیره…" : "ذخیرهٴ زنگ‌بندی"}
        </Button>
        <Button type="button" size="lg" variant="outline" onClick={cancel} disabled={pending}>
          انصراف
        </Button>
      </div>
    </div>
  );
}
