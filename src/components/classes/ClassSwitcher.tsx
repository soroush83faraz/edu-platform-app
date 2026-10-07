"use client";

import { Check, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ResponsiveModal } from "@/components/admin/ResponsiveModal";
import { SubjectIcon, SubjectSwatch } from "@/components/SubjectStamp";
import { cn } from "@/lib/cn";
import { formatNumberFa } from "@/lib/format";

export interface SwitcherOffering {
  offeringId: string;
  subjectId: string;
  subjectName: string;
  classGroupName: string;
  /** The teacher's own colour of this class (`teacherOfferingHues`). */
  hue: number;
  /** My open items of this درس — «۲ تکلیف در انتظار». */
  openCount: number;
}

/**
 * The دبیر's class switcher on the subject page (mock class-page-v3, screens 1–2): a 44 px control «■ کلاس ۱۲/۳ ▾» —
 * the square is this class's own colour — that opens «کلاس‌های من»: a bottom sheet on phones, a dialog from `md:`
 * (`ResponsiveModal fit`), listing every class the دبیر teaches (درس · کلاس, its نشان درس in that class's colour,
 * «N تکلیف در انتظار»), the current one checked. A choice is a plain link: the whole page becomes that class's.
 */
export function ClassSwitcher({ currentId, offerings }: { currentId: string; offerings: SwitcherOffering[] }) {
  const [open, setOpen] = useState(false);
  const current = offerings.find((o) => o.offeringId === currentId);
  if (!current) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex min-h-11 w-max items-center gap-2 rounded-lg border border-line bg-surface-sunken ps-3 pe-2.5 text-sm font-semibold text-text hover:border-line-strong"
      >
        <SubjectSwatch subjectId={current.subjectId} hue={current.hue} />
        <span>
          کلاس <bdi>{current.classGroupName}</bdi>
        </span>
        <span className="sr-only">— عوض کردن کلاس</span>
        <ChevronDown className="size-4 text-text-muted" aria-hidden />
      </button>
      <ResponsiveModal open={open} onOpenChange={setOpen} title="کلاس‌های من" fit>
        <ul className="flex flex-col gap-1 pt-2">
          {offerings.map((o) => {
            const isCurrent = o.offeringId === currentId;
            return (
              <li key={o.offeringId}>
                <Link
                  prefetch={false}
                  href={`/subjects/${o.offeringId}`}
                  aria-current={isCurrent ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={cn("pressable flex min-h-14 items-center gap-3 rounded-lg px-2 py-1.5", isCurrent ? "bg-primary-50" : "hover:bg-surface-sunken")}
                >
                  <SubjectIcon subjectId={o.subjectId} name={o.subjectName} hue={o.hue} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-row font-semibold text-text">
                      <bdi>{o.subjectName}</bdi> · کلاس <bdi>{o.classGroupName}</bdi>
                    </span>
                    <span className="text-meta text-text-muted">{o.openCount > 0 ? `${formatNumberFa(o.openCount)} تکلیف در انتظار` : "تکلیفی در انتظار نیست"}</span>
                  </span>
                  {isCurrent ? <Check className="size-5 shrink-0 text-primary-600" aria-label="کلاس فعلی" /> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </ResponsiveModal>
    </>
  );
}
