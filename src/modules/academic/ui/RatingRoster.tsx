"use client";

import { Check, CircleCheck, Sparkles, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { formatNumberFa, toFaDigits } from "@/lib/format";
import { OBJECTIVE_RATINGS, RATING_LABELS, RATING_ON_CLASSES, isSheetComplete, type ObjectiveRating } from "@/lib/objective-rating";
import { saveObjectiveRatingsAction } from "../actions";
import { DOMAIN_LABELS_FA } from "../primary-objectives";
import type { RatingSheet } from "../report-card";

type Marks = Record<string, Record<string, ObjectiveRating | null>>;

const initialMarks = (data: RatingSheet): Marks =>
  Object.fromEntries(data.rows.map((r) => [r.studentProfileId, Object.fromEntries(data.objectives.map((o) => [o.id, r.ratings[o.id] ?? null]))]));

/**
 * «ثبت کارنامه» for one sheet (a class × month × درس), built like the attendance roster: one card per student, each
 * objective of the month with its domain as a quiet label and a four-way segmented control
 * (خیلی خوب / خوب / قابل قبول / نیاز به تلاش — every segment a 44 px target; tapping the pressed one clears it),
 * a «همه خیلی خوب» shortcut per student, and ONE sticky footer carrying the live progress
 * («۱۸ از ۲۴ دانش‌آموز ثبت شده») and the one primary action. Nothing is saved until that button: the changed pairs go
 * in ONE action (one transaction, upsert), so a second save updates instead of duplicating.
 */
export function RatingRoster({ data }: { data: RatingSheet }) {
  const router = useRouter();
  const [initial, setInitial] = useState<Marks>(() => initialMarks(data));
  const [marks, setMarks] = useState<Marks>(initial);
  const [pending, start] = useTransition();
  const ids = useMemo(() => data.objectives.map((o) => o.id), [data.objectives]);

  const complete = data.rows.filter((r) => isSheetComplete(ids, marks[r.studentProfileId] ?? {})).length;
  const changed = data.rows.flatMap((r) =>
    ids.filter((id) => (marks[r.studentProfileId]?.[id] ?? null) !== (initial[r.studentProfileId]?.[id] ?? null)).map((id) => ({ studentProfileId: r.studentProfileId, learningObjectiveId: id, rating: marks[r.studentProfileId]?.[id] ?? null })),
  );

  const set = (studentProfileId: string, objectiveId: string, rating: ObjectiveRating) =>
    setMarks((m) => {
      const current = m[studentProfileId]?.[objectiveId] ?? null;
      return { ...m, [studentProfileId]: { ...m[studentProfileId], [objectiveId]: current === rating ? null : rating } };
    });
  const allVeryGood = (studentProfileId: string) => setMarks((m) => ({ ...m, [studentProfileId]: Object.fromEntries(ids.map((id) => [id, "very_good" as const])) }));

  const save = () => {
    if (changed.length === 0) {
      toast.info("تغییری برای ثبت نیست.");
      return;
    }
    start(async () => {
      const res = await saveObjectiveRatingsAction({ classGroupId: data.classGroup.id, month: data.month, subjectName: data.subjectName, entries: changed });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setInitial(marks);
      toast.success(`کارنامه ثبت شد — ${formatNumberFa(res.data.complete)} از ${formatNumberFa(res.data.students)} دانش‌آموز کامل`);
      router.refresh();
    });
  };

  if (data.rows.length === 0) {
    return <p className="rounded-card border border-warning/40 bg-warning-soft/40 px-4 py-3 text-sm text-text">این کلاس هنوز دانش‌آموز فعالی ندارد؛ اول دانش‌آموزان را در کلاس ثبت‌نام کنید.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="reveal-rows flex flex-col gap-3">
        {data.rows.map((r) => {
          const mine = marks[r.studentProfileId] ?? {};
          const rated = ids.filter((id) => mine[id]).length;
          return (
            <li key={r.studentProfileId} className="surface-work flex flex-col gap-1 py-2">
              <div className="flex items-center justify-between gap-2 px-4 pt-1">
                <div className="flex min-w-0 flex-col">
                  <p className="truncate text-row font-medium text-text">
                    <bdi>{r.fullName}</bdi>
                  </p>
                  <p className="text-meta text-text-muted">
                    {rated === ids.length ? (
                      <span className="text-success">ثبت‌شده</span>
                    ) : (
                      <>
                        <span className="tabular">{formatNumberFa(rated)}</span> از <span className="tabular">{formatNumberFa(ids.length)}</span> هدف
                      </>
                    )}
                    {r.studentNumber ? (
                      <bdi dir="ltr" className="tabular ms-2 text-text-faint">
                        {toFaDigits(r.studentNumber)}
                      </bdi>
                    ) : null}
                  </p>
                </div>
                {data.canWrite ? (
                  <Button type="button" variant="ghost" onClick={() => allVeryGood(r.studentProfileId)} disabled={pending} className="shrink-0">
                    <Sparkles aria-hidden />
                    همه خیلی خوب
                  </Button>
                ) : null}
              </div>
              <ol className="flex flex-col divide-y divide-line/70">
                {data.objectives.map((o) => (
                  <li key={o.id} className="flex flex-col gap-2 px-4 py-3 lg:grid lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-center lg:gap-4">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <p className="text-sm text-text">{o.text}</p>
                      {o.domain ? <p className="text-meta text-text-faint">{DOMAIN_LABELS_FA[o.domain]}</p> : null}
                    </div>
                    <div role="group" aria-label={`سطح «${o.text}» برای ${r.fullName}`} className="grid grid-cols-4 gap-1 rounded-xl bg-surface-sunken p-1">
                      {OBJECTIVE_RATINGS.map((level) => {
                        const on = mine[o.id] === level;
                        return (
                          <button
                            key={level}
                            type="button"
                            data-on={on}
                            aria-pressed={on}
                            disabled={!data.canWrite || pending}
                            onClick={() => set(r.studentProfileId, o.id, level)}
                            className={cn(
                              "pressable flex min-h-11 items-center justify-center rounded-lg px-1 text-center text-meta leading-tight font-medium text-text-muted transition-colors",
                              "disabled:opacity-60 hover:bg-surface",
                              RATING_ON_CLASSES[level],
                            )}
                          >
                            {RATING_LABELS[level]}
                          </button>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ol>
            </li>
          );
        })}
      </ul>

      {/* The bar of the attendance roster (commit 08f2c59), class for class: pinned flush to the phone's bottom edge in
          the hub shell (no bottom nav), its padding growing by the home-indicator inset; the classic shell lifts it
          above its nav bar; from `lg:` a card that floats at the bottom. `-mb-16` eats the bottom padding of
          ContentWidth and <main> so a short roster ends on the screen edge. */}
      {data.canWrite ? (
        <div className="sticky bottom-0 z-30 max-lg:group-data-[shell=hub]/shell:-mb-16 -mx-4 border-t border-line bg-surface/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur group-data-[shell=classic]/shell:bottom-[calc(3.5rem+env(safe-area-inset-bottom))] group-data-[shell=classic]/shell:pb-3 lg:bottom-4 lg:mx-0 lg:rounded-card lg:border lg:pb-3 lg:group-data-[shell=classic]/shell:bottom-4">
          <div className="mx-auto flex w-full max-w-content items-center justify-between gap-3">
            <p className="min-w-0 text-meta text-text-muted">
              <CircleCheck className="me-1 inline size-4 align-text-bottom text-success" aria-hidden />
              <span className="tabular font-medium text-text">{formatNumberFa(complete)}</span> از <span className="tabular">{formatNumberFa(data.rows.length)}</span> دانش‌آموز ثبت شده
            </p>
            <Button type="button" size="lg" onClick={save} disabled={pending} className="shrink-0">
              {pending ? "در حال ثبت…" : data.saved ? <><Check aria-hidden />ذخیرهٴ تغییرات</> : "ثبت کارنامه"}
            </Button>
          </div>
        </div>
      ) : (
        <p className="flex items-start gap-2 px-1 text-meta text-text-muted">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden />
          شما این کارنامه را فقط می‌بینید؛ ثبت آن با آموزگار کلاس یا مدیر و معاون مدرسه است.
        </p>
      )}
    </div>
  );
}
