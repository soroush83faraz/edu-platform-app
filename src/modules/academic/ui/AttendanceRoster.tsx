"use client";

import { Check, CircleCheck, Clock, TriangleAlert, UserRoundCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ATTENDANCE_LABELS, summaryLineFa, tally, type AttendanceStatus } from "@/lib/attendance";
import { formatNumberFa } from "@/lib/format";
import { toAsciiDigits } from "@/lib/normalize";
import { takeAttendanceAction } from "../actions";
import type { SessionForTaking } from "../attendance";

type Mark = { status: AttendanceStatus; minutesLate: number | null };

/** The status buttons in the order a teacher reads them; only «تأخیر» opens the minutes field. */
const CHOICES: Array<{ status: AttendanceStatus; className: string }> = [
  { status: "present", className: "data-[on=true]:bg-success data-[on=true]:text-white" },
  { status: "absent", className: "data-[on=true]:bg-danger data-[on=true]:text-white" },
  { status: "late", className: "data-[on=true]:bg-warning data-[on=true]:text-warning-text" },
  { status: "excused", className: "data-[on=true]:bg-primary-600 data-[on=true]:text-white" },
];

/**
 * «ثبت حضور و غیاب» for one زنگ: the class roster, each student with a four-way segmented control
 * (حاضر / غایب / تأخیر / موجه) that is a real 44 px target at every width, an optional «دقیقهٴ تأخیر» field that
 * appears only on تأخیر, the «همه حاضر» shortcut, and a sticky footer that carries the live count and the one
 * primary action. Nothing is saved until that button: the whole roll call goes in ONE action (the service upserts
 * the session and its entries in one transaction, so a second save UPDATES instead of duplicating). A saved roll
 * call reopens with its marks pre-filled and the «ثبت‌شده در …» line above the list.
 */
export function AttendanceRoster({ data }: { data: SessionForTaking }) {
  const router = useRouter();
  const [marks, setMarks] = useState<Record<string, Mark>>(() =>
    Object.fromEntries(data.rows.map((r) => [r.studentProfileId, { status: r.status, minutesLate: r.minutesLate }])),
  );
  const [pending, start] = useTransition();
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const counts = tally(data.rows.map((r) => marks[r.studentProfileId]?.status ?? "present"));
  const summary = summaryLineFa(counts);
  const set = (studentProfileId: string, patch: Partial<Mark>) =>
    setMarks((m) => ({ ...m, [studentProfileId]: { status: patch.status ?? m[studentProfileId].status, minutesLate: patch.minutesLate === undefined ? m[studentProfileId].minutesLate : patch.minutesLate } }));

  const allPresent = () => setMarks(Object.fromEntries(data.rows.map((r) => [r.studentProfileId, { status: "present" as const, minutesLate: null }])));

  const save = () => {
    start(async () => {
      const res = await takeAttendanceAction({
        classGroupId: data.classGroup.id,
        date: data.date,
        periodNo: data.periodNo,
        entries: data.rows.map((r) => {
          const m = marks[r.studentProfileId];
          return { studentProfileId: r.studentProfileId, status: m.status, minutesLate: m.status === "late" ? m.minutesLate : null };
        }),
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setSavedAt(new Date().toISOString());
      toast.success(summary ? `حضور و غیاب ثبت شد — ${summary}` : "حضور و غیاب ثبت شد — همه حاضر");
      router.refresh();
    });
  };

  if (data.rows.length === 0) {
    return <p className="rounded-card border border-warning/40 bg-warning-soft/40 px-4 py-3 text-sm text-text">این کلاس هنوز دانش‌آموز فعالی ندارد؛ اول دانش‌آموزان را در کلاس ثبت‌نام کنید.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-meta text-text-muted">
          <span className="tabular font-medium text-text">{formatNumberFa(data.rows.length)}</span> دانش‌آموز
          {savedAt || data.saved ? <span className="ms-2 text-success">ثبت‌شده</span> : null}
        </p>
        {data.canWrite ? (
          <Button type="button" variant="outline" onClick={allPresent}>
            <UserRoundCheck aria-hidden />
            همه حاضر
          </Button>
        ) : null}
      </div>

      <ul className="reveal-rows flex flex-col divide-y divide-line/70 surface-work">
        {data.rows.map((r) => {
          const m = marks[r.studentProfileId];
          return (
            <li key={r.studentProfileId} className="flex flex-col gap-2 px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-row font-medium text-text">
                  <bdi>{r.fullName}</bdi>
                </p>
                {r.studentNumber ? (
                  <bdi dir="ltr" className="tabular shrink-0 text-meta text-text-faint">
                    {r.studentNumber}
                  </bdi>
                ) : null}
              </div>
              <div role="group" aria-label={`وضعیت ${r.fullName}`} className="grid grid-cols-4 gap-1 rounded-xl bg-surface-sunken p-1">
                {CHOICES.map((c) => {
                  const on = m.status === c.status;
                  return (
                    <button
                      key={c.status}
                      type="button"
                      data-on={on}
                      aria-pressed={on}
                      disabled={!data.canWrite || pending}
                      onClick={() => set(r.studentProfileId, { status: c.status, minutesLate: c.status === "late" ? m.minutesLate : null })}
                      className={cn(
                        "pressable flex min-h-11 items-center justify-center rounded-lg px-1 text-sm font-medium text-text-muted transition-colors",
                        "disabled:opacity-60 hover:bg-surface",
                        c.className,
                      )}
                    >
                      {ATTENDANCE_LABELS[c.status]}
                    </button>
                  );
                })}
              </div>
              {m.status === "late" ? (
                <label className="flex items-center gap-2 px-1 text-meta text-text-muted">
                  <Clock className="size-4 shrink-0 text-warning-text" aria-hidden />
                  دقیقهٴ تأخیر
                  <Input
                    value={m.minutesLate === null ? "" : formatNumberFa(m.minutesLate)}
                    onChange={(e) => {
                      const raw = toAsciiDigits(e.target.value).replace(/\D/g, "");
                      set(r.studentProfileId, { minutesLate: raw === "" ? null : Math.min(600, Number(raw)) });
                    }}
                    inputMode="numeric"
                    aria-label={`دقیقهٴ تأخیر ${r.fullName}`}
                    disabled={!data.canWrite || pending}
                    className="tabular h-11 w-20 text-center"
                  />
                </label>
              ) : null}
            </li>
          );
        })}
      </ul>

      {/* Sticky above the phone nav bar (3.5 rem + safe area); a card that floats at the bottom from `lg:`. */}
      {data.canWrite ? (
        <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 -mx-4 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur lg:bottom-4 lg:mx-0 lg:rounded-card lg:border">
          <div className="mx-auto flex w-full max-w-content items-center justify-between gap-3">
            <p className="min-w-0 text-meta text-text-muted">
              <CircleCheck className="me-1 inline size-4 align-text-bottom text-success" aria-hidden />
              <span className="tabular font-medium text-text">{formatNumberFa(counts.present + counts.late)}</span> حاضر
              {summary ? <span className="ms-2">{summary}</span> : null}
            </p>
            <Button type="button" size="lg" onClick={save} disabled={pending} className="shrink-0">
              {pending ? "در حال ثبت…" : data.saved || savedAt ? <><Check aria-hidden />ذخیرهٴ تغییرات</> : "ثبت حضور و غیاب"}
            </Button>
          </div>
        </div>
      ) : (
        <p className="flex items-start gap-2 px-1 text-meta text-text-muted">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden />
          شما این حضور و غیاب را فقط می‌بینید؛ ثبت آن با دبیر همین زنگ یا مدیر مدرسه است (و برای روز آینده ممکن نیست).
        </p>
      )}
    </div>
  );
}
