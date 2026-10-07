import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Chip } from "@/components/Chip";
import { SubjectIcon } from "@/components/SubjectStamp";
import { formatNumberFa } from "@/lib/format";
import { offeringHue, type OfferingHues } from "@/lib/subject-stamp";
import { CALENDAR_WEEKDAYS, formatTimeFa, timeToMinutes, WEEKDAY_LABELS, type WeekCell, type Weekday } from "@/lib/timetable";
import type { DayView } from "./types";

/** One of a دبیر's classes in the week: an offering (درس × کلاس) with its periods per week and its next session. */
export interface WeekClass {
  offeringId: string;
  subjectId: string;
  subjectName: string;
  classGroupName: string;
  periodsPerWeek: number;
  /** The session ringing now, or else the next one from now (wrapping round the week). */
  next: { now: true } | { now: false; weekday: Weekday; startsAt: string; today: boolean };
}

const WEEK_MINUTES = 7 * 24 * 60;

/**
 * Every offering of the week once, by class then درس, with its number of periods and its next session from the
 * live clock (`today`, `nowMinutes`): a session that is ringing reads «الان».
 */
export function weekClasses(days: readonly DayView[], today: Weekday, nowMinutes: number): WeekClass[] {
  const at = (d: number, minutes: number) => CALENDAR_WEEKDAYS.indexOf(d as Weekday) * 24 * 60 + minutes;
  const now = at(today, nowMinutes);
  const byOffering = new Map<string, { cls: WeekClass; ahead: number }>();
  for (const day of days) {
    for (const s of day.sessions) {
      const start = at(day.weekday, timeToMinutes(s.startsAt));
      const end = at(day.weekday, timeToMinutes(s.endsAt));
      const ringing = start <= now && now < end;
      const ahead = ringing ? -1 : (start - now + WEEK_MINUTES) % WEEK_MINUTES;
      const next: WeekClass["next"] = ringing ? { now: true } : { now: false, weekday: day.weekday, startsAt: s.startsAt, today: day.weekday === today && start > now };
      const seen = byOffering.get(s.offeringId);
      if (!seen) {
        byOffering.set(s.offeringId, { cls: { offeringId: s.offeringId, subjectId: s.subjectId, subjectName: s.subjectName, classGroupName: s.classGroupName, periodsPerWeek: 1, next }, ahead });
        continue;
      }
      seen.cls.periodsPerWeek += 1;
      if (ahead < seen.ahead) {
        seen.cls.next = next;
        seen.ahead = ahead;
      }
    }
  }
  return [...byOffering.values()]
    .map((x) => x.cls)
    .sort((a, b) => a.classGroupName.localeCompare(b.classGroupName, "fa", { numeric: true }) || a.subjectName.localeCompare(b.subjectName, "fa"));
}

/** The offerings that meet in one grid cell (one, or several when a دبیر has two classes in the same زنگ). */
export function cellOfferings(days: readonly DayView[], cell: WeekCell): string[] {
  return (days.find((d) => d.weekday === cell.weekday)?.sessions ?? []).filter((s) => s.periodNo === cell.periodNo).map((s) => s.offeringId);
}

export interface WeekClassListProps {
  classes: readonly WeekClass[];
  /** The offerings of the tapped cell or row — their rows are emphasised; empty when nothing is selected. */
  selected: readonly string[];
  /** Tapping a row selects its class in the grid (again: clears) — it never navigates; the chevron opens the درس. */
  onSelect?: (offeringId: string) => void;
  /** The دبیر's own colour per class (`teacherOfferingHues`) — the row mark matches the class's cells. */
  hues?: OfferingHues;
}

/**
 * A دبیر's classes under the phone week grid (owner 2026-09-27: "list all their classes at the bottom, and when they
 * tap the schedule just make that one bolder"). Each row: the درس's `SubjectIcon`, the درس, «کلاس X · N زنگ در
 * هفته», its next session (or «الان»), and a 44 px chevron link that opens `/subjects/[offeringId]`. The row body is
 * a toggle button (`aria-pressed`) that selects the class in the grid; the selected row (`data-selected`) turns
 * bolder on a `primary-50` ground with a brand hairline and a 1 % lift (no lift under reduced motion).
 */
export function WeekClassList({ classes, selected, onSelect, hues }: WeekClassListProps) {
  if (classes.length === 0) return null;
  return (
    <div data-week-classes="" className="mt-2 border-t border-line/70 pt-2">
      <p className="px-2 pb-1 text-meta text-text-muted">
        کلاس‌های این هفته <span className="tabular">({formatNumberFa(classes.length)})</span>
      </p>
      <ul className="flex flex-col gap-1">
        {classes.map((c) => {
          const on = selected.includes(c.offeringId);
          return (
            <li
              key={c.offeringId}
              data-selected={on ? "" : undefined}
              className={cn(
                "flex items-center gap-1 rounded-xl ring-1 ring-inset transition-[background-color,box-shadow,scale] duration-200 ease-out motion-reduce:transition-none",
                on ? "bg-primary-50 ring-primary-200 motion-safe:scale-[1.01]" : "ring-transparent",
              )}
            >
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onSelect?.(c.offeringId)}
                className="pressable flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 text-start outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <SubjectIcon subjectId={c.subjectId} name={c.subjectName} hue={offeringHue(hues, c.offeringId, c.subjectId)} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cn("truncate text-row transition-colors duration-200 motion-reduce:transition-none", on ? "font-bold text-primary-900" : "font-semibold text-text")}>
                    <bdi>{c.subjectName}</bdi>
                  </span>
                  <span className="truncate text-meta text-text-muted">
                    <bdi>کلاس {c.classGroupName}</bdi>
                    {" · "}
                    <span className="tabular">{formatNumberFa(c.periodsPerWeek)}</span> زنگ در هفته
                  </span>
                </span>
                {c.next.now ? (
                  <Chip tone="primary">الان</Chip>
                ) : (
                  <span className="flex shrink-0 flex-col items-end text-meta text-text-muted">
                    <span>{c.next.today ? "امروز" : WEEKDAY_LABELS[c.next.weekday]}</span>
                    <bdi dir="ltr" className="tabular">
                      {formatTimeFa(c.next.startsAt)}
                    </bdi>
                  </span>
                )}
              </button>
              <Link
                prefetch={false}
                href={`/subjects/${c.offeringId}`}
                aria-label={`باز کردن ${c.subjectName}، کلاس ${c.classGroupName}`}
                className={cn(
                  "pressable me-1 grid size-11 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  on ? "bg-primary-100 text-primary-700" : "text-text-faint hover:bg-surface-sunken",
                )}
              >
                <ChevronLeft className="size-5" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
