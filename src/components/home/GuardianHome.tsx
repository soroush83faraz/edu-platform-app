import { Award, CalendarCheck2, CalendarRange, ChevronLeft, NotebookPen, UserRound } from "lucide-react";
import Link from "next/link";
import { PageSection } from "@/components/layout/PageSection";
import { RowMark } from "@/components/RowMark";
import { cn } from "@/lib/cn";
import type { Ctx } from "@/lib/ctx";
import { formatNumberFa } from "@/lib/format";
import { childHref, homeChildHref, pickChild } from "@/modules/iam/guardian-policy";
import type { GuardianChild } from "@/modules/iam/guardian-queries";
import { getMyChildren, resolveHomeTiles } from "./home-data";
import { Tile } from "./Tile";

const GRID = "reveal-grid grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7";

/** The guardian's tiles for ONE child (`labels` already holds the labels the person's other tiles use). */
function childTiles(child: GuardianChild, taken: ReadonlySet<string>) {
  const label = (base: string) => (taken.has(base) ? `${base} فرزند` : base);
  return [
    { code: "child-work", labelFa: "تکالیف فرزند", href: childHref("work", child.studentProfileId), icon: NotebookPen },
    { code: "child-attendance", labelFa: label("حضور و غیاب"), href: childHref("attendance", child.studentProfileId), icon: CalendarCheck2 },
    ...(child.primary ? [{ code: "child-report-card", labelFa: label("کارنامه"), href: childHref("report-card", child.studentProfileId), icon: Award }] : []),
    { code: "child-timetable", labelFa: label("برنامهٴ کلاسی"), href: childHref("timetable", child.studentProfileId), icon: CalendarRange },
  ];
}

/** One child's card: name, class · school, and — only when it is a problem — the overdue تکالیف with a red dot. */
function ChildCardBody({ child }: { child: GuardianChild }) {
  return (
    <>
      <RowMark icon={UserRound} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-row font-semibold text-text">
          <bdi>
            {child.firstName} {child.lastName}
          </bdi>
        </span>
        <span className="truncate text-meta text-text-muted">
          {child.className ? (
            <>
              کلاس <bdi>{child.className}</bdi>
            </>
          ) : (
            "هنوز در کلاسی ثبت نشده"
          )}
          {child.schoolName ? (
            <>
              {" · "}
              <bdi>{child.schoolName}</bdi>
            </>
          ) : null}
        </span>
        {child.overdue > 0 ? (
          <span className="flex items-center gap-1.5 text-meta text-text">
            <span className="size-2 rounded-full bg-danger" aria-hidden />
            {formatNumberFa(child.overdue)} تکلیف مهلت‌گذشته
          </span>
        ) : null}
      </span>
    </>
  );
}

/**
 * «فرزندان» on Home (owner, 2026-10-18): one card per live child — name, class, school — and the selected child's
 * tiles under them: «تکالیف فرزند», «حضور و غیاب», «کارنامه» (a primary class only), «برنامهٴ کلاسی». With several
 * children each card is the switch (`/home?child=…`, the server picks among the guardian's own children — an unknown
 * id simply selects the first); a single child's card is static. A colleague who is also a parent sees this section
 * under their own tiles — whose labels a child tile never repeats («حضور و غیاب فرزند»): one name, one door.
 */
export async function GuardianHome({ ctx, selected }: { ctx: Ctx; selected?: string }) {
  const children = await getMyChildren();
  if (children.length === 0) return null;
  const takenLabels = (await resolveHomeTiles(ctx)).tiles.map((t) => t.labelFa);
  const child = pickChild(children, selected) ?? children[0];
  const several = children.length > 1;
  return (
    <PageSection id="children" title="فرزندان" count={several ? children.length : undefined}>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {children.map((c) => {
          const on = c.studentProfileId === child.studentProfileId;
          return (
            <li key={c.studentProfileId} className="flex">
              {several ? (
                <Link
                  prefetch={false}
                  href={homeChildHref(c.studentProfileId)}
                  aria-current={on ? "true" : undefined}
                  className={cn("surface-work surface-link pressable flex w-full items-center gap-3 rounded-card px-3.5 py-3", on && "ring-2 ring-primary-200")}
                >
                  <ChildCardBody child={c} />
                  <ChevronLeft className="size-4 shrink-0 text-text-faint" aria-hidden />
                </Link>
              ) : (
                <div className="surface-work flex w-full items-center gap-3 rounded-card px-3.5 py-3">
                  <ChildCardBody child={c} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <nav aria-label={`بخش‌های ${child.firstName}`}>
        <ul className={GRID}>
          {childTiles(child, new Set(takenLabels)).map((t) => (
            <Tile key={t.code} href={t.href} label={t.labelFa} icon={t.icon} />
          ))}
        </ul>
      </nav>
    </PageSection>
  );
}
