import { DoorOpen } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { Chip } from "@/components/Chip";
import { formatTimeFa, type SessionState } from "@/lib/timetable";
import type { SessionSecondary, SessionView } from "./types";

/**
 * One زنگ of a day, read left to right in RTL as: the time column (start over end, Persian digits inside an LTR
 * bdi), then the subject and its second line (teacher for students, class for teachers), then the room and the
 * state chip. The whole card is the tap target and opens the subject page. States: `current` — the one raised,
 * info-tinted card with a persian-blue start edge and «الان»; `next` — «بعدی»; `past` — dimmed, still tappable.
 */
export function SessionCard({ session, state, secondary, href }: { session: SessionView; state: SessionState; secondary: SessionSecondary; href?: string }) {
  const second = secondary === "teacher" ? (session.teacherName ?? "معلم هنوز مشخص نشده") : `کلاس ${session.classGroupName}`;
  return (
    <li>
      <Link
        href={href ?? `/subjects/${session.offeringId}`}
        aria-current={state === "current" ? "true" : undefined}
        className={cn(
          "pressable relative flex min-h-[4.5rem] items-stretch gap-3 rounded-card bg-surface p-3 shadow-1 hover:bg-surface-sunken",
          state === "current" && "bg-info-soft ring-2 ring-primary-600/70 hover:bg-info-soft",
          state === "past" && "opacity-65",
        )}
      >
        <bdi dir="ltr" className={cn("tabular flex w-12 shrink-0 flex-col justify-center text-center text-sm leading-5", state === "current" ? "font-semibold text-primary-800" : "text-text-muted")}>
          <span>{formatTimeFa(session.startsAt)}</span>
          <span className={cn("text-xs", state === "current" ? "text-primary-800/70" : "text-text-faint")}>{formatTimeFa(session.endsAt)}</span>
        </bdi>
        <span aria-hidden className={cn("w-px self-stretch rounded-full", state === "current" ? "bg-primary-600/40" : "bg-line")} />
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
          <p className={cn("truncate text-base leading-6", state === "current" ? "font-bold text-primary-900" : "font-semibold text-text")}>
            <bdi>{session.subjectName}</bdi>
          </p>
          <p className={cn("truncate text-sm", state === "current" ? "text-primary-800/80" : "text-text-muted")}>
            <bdi>{second}</bdi>
            <span className="text-text-faint"> · {session.label}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end justify-center gap-1.5">
          {state === "current" ? <Chip tone="primary">الان</Chip> : state === "next" ? <Chip tone="neutral">بعدی</Chip> : null}
          {session.room ? (
            <span className="inline-flex items-center gap-1 text-xs text-text-muted">
              <DoorOpen className="size-3.5" aria-hidden />
              <bdi>{session.room}</bdi>
            </span>
          ) : null}
        </div>
      </Link>
    </li>
  );
}
