// «کارنامهٴ توصیفی» — the server-rendered pieces the report-card pages share: the level pill, the month switcher,
// one درس of a student's card (student page) and the printable A4 card. No state, no client JS.
import Link from "next/link";
import { cn } from "@/lib/cn";
import { SubjectIcon } from "@/components/SubjectStamp";
import { formatNumberFa, toFaDigits } from "@/lib/format";
import { RATING_LABELS, RATING_PILL_CLASSES, ratingSummaryFa, type ObjectiveRating } from "@/lib/objective-rating";
import { DOMAIN_LABELS_FA, jalaliMonthName } from "../primary-objectives";
import type { ReportCardSubject, StudentReportCard } from "../report-card";

/** A level as a pill (`text-xs`, pills only); «ثبت نشده» for an objective without one. */
export function RatingPill({ rating, label, className }: { rating: ObjectiveRating | null; label?: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-medium whitespace-nowrap",
        rating ? RATING_PILL_CLASSES[rating] : "bg-surface-sunken text-text-muted",
        className,
      )}
    >
      {label ?? (rating ? RATING_LABELS[rating] : "ثبت نشده")}
    </span>
  );
}

/** The months of the پایه as a row of links (the current one marked), like the attendance page's زنگ switcher. */
export function MonthNav({ months, current, hrefFor }: { months: readonly number[]; current: number | null; hrefFor: (month: number) => string }) {
  if (months.length <= 1) return null;
  return (
    <nav aria-label="ماه" className="no-print -mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
      <ul className="flex w-max min-w-full gap-1.5">
        {months.map((m) => {
          const on = m === current;
          return (
            <li key={m}>
              <Link
                prefetch={false}
                href={hrefFor(m)}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "pressable flex min-h-11 items-center rounded-xl border px-4 text-sm whitespace-nowrap",
                  on ? "border-primary-600/40 bg-primary-50 font-medium text-primary-800" : "border-line bg-surface text-text-muted hover:bg-surface-sunken",
                )}
              >
                {jalaliMonthName(m)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** «پایهٴ اول» — the grade as a reader names it. */
export function gradeLabelFa(gradeName: string): string {
  return `پایهٴ ${gradeName}`;
}

/** The empty state line that names the context («برای پایهٴ اول در ماه آذر هدفی ثبت نشده است»). */
export function noObjectivesFa(gradeName: string, month: number | null): string {
  return month === null ? `برای ${gradeLabelFa(gradeName)} هدف آموزشی‌ای ثبت نشده است.` : `برای ${gradeLabelFa(gradeName)} در ماه ${jalaliMonthName(month)} هدفی ثبت نشده است.`;
}

/** One درس of a student's card: the درس as a header row (its نشان), then each objective with its domain and level. */
export function CardSubject({ subject }: { subject: ReportCardSubject }) {
  const summary = ratingSummaryFa(subject.counts);
  return (
    <section aria-label={subject.name} className="surface-work overflow-hidden">
      <header className="flex items-center gap-3 border-b border-line/70 px-4 py-3">
        <SubjectIcon subjectId={subject.subjectId ?? subject.name} name={subject.name} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="truncate text-row font-semibold text-text">{subject.name}</h3>
          <p className="truncate text-meta text-text-muted">{summary || `${formatNumberFa(subject.objectives.length)} هدف · هنوز ثبت نشده`}</p>
        </div>
      </header>
      <ul className="divide-y divide-line/70">
        {subject.objectives.map((o) => (
          <li key={o.id} className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-sm text-text">{o.text}</p>
              {o.domain ? <p className="text-meta text-text-faint">{DOMAIN_LABELS_FA[o.domain]}</p> : null}
            </div>
            <RatingPill rating={o.rating} className="mt-0.5" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The printable A4 report card of ONE student for one month: school, student, class, پایه, year and month at the
 * top, then every درس as a table (هدف · حیطه · سطح). Each card starts a new page (`print-page`). On screen it is a
 * white sheet; in print the app frame disappears (globals.css @media print).
 */
export function PrintableCard({ card }: { card: StudentReportCard }) {
  const cg = card.classGroup;
  return (
    <article className="print-page print-card surface-work flex flex-col gap-4 p-5 text-text print:rounded-none print:p-0 print:shadow-none">
      <header className="flex flex-col gap-1 border-b border-line pb-3 text-center">
        <p className="text-meta text-text-muted">
          <bdi>{cg.schoolName}</bdi>
        </p>
        <h2 className="text-section font-bold">کارنامهٴ توصیفی — ماه {card.monthName}</h2>
        <p className="text-sm">
          <bdi className="font-semibold">{card.fullName}</bdi>
          {card.studentNumber ? (
            <>
              {" · "}
              <bdi dir="ltr" className="tabular">
                {toFaDigits(card.studentNumber)}
              </bdi>
            </>
          ) : null}
        </p>
        <p className="text-meta text-text-muted">
          {gradeLabelFa(cg.gradeName)} · کلاس <bdi>{cg.name}</bdi> · سال تحصیلی <bdi>{cg.academicYearName}</bdi>
        </p>
      </header>
      {card.subjects.length === 0 ? <p className="text-sm text-text-muted">{noObjectivesFa(cg.gradeName, card.month)}</p> : null}
      {card.subjects.map((s) => (
        <table key={s.name} className="print-avoid w-full border-collapse text-sm">
          <caption className="pb-1 text-start text-row font-semibold">{s.name}</caption>
          <thead>
            <tr className="bg-surface-sunken text-meta text-text-muted">
              <th scope="col" className="border border-line px-2 py-1 text-start font-medium">
                هدف آموزشی
              </th>
              <th scope="col" className="w-20 border border-line px-2 py-1 text-start font-medium">
                حیطه
              </th>
              <th scope="col" className="w-28 border border-line px-2 py-1 text-start font-medium">
                سطح
              </th>
            </tr>
          </thead>
          <tbody>
            {s.objectives.map((o) => (
              <tr key={o.id}>
                <td className="border border-line px-2 py-1.5 align-top">{o.text}</td>
                <td className="border border-line px-2 py-1.5 align-top text-meta text-text-muted">{o.domain ? DOMAIN_LABELS_FA[o.domain] : "—"}</td>
                <td className="border border-line px-2 py-1.5 align-top">{o.rating ? RATING_LABELS[o.rating] : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      <footer className="mt-auto grid grid-cols-2 gap-6 pt-6 text-meta text-text-muted">
        <p className="border-t border-line pt-2 text-center">امضای آموزگار</p>
        <p className="border-t border-line pt-2 text-center">امضای مدیر مدرسه</p>
      </footer>
    </article>
  );
}
