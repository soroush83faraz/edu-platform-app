import { BookOpen, CalendarClock, CalendarDays, ChevronLeft, GraduationCap, Plus, Users, UsersRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageSection } from "@/components/layout/PageSection";
import { StaffRow, StudentRow } from "@/components/admin/PeopleRows";
import { ResourceForm } from "@/components/admin/ResourceForm";
import { RowMark } from "@/components/RowMark";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { SchoolHubFacts } from "@/components/admin/SchoolHubFacts";
import { GENDER_LABELS, schoolResource } from "@/lib/admin/resources";
import { schoolHubQuery, type SchoolHubData } from "@/lib/admin/school-queries";
import { formatNumberFa, isoDateToJalali } from "@/lib/format";

export const metadata: Metadata = { title: "مدرسه | مدیریت" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const n = formatNumberFa;

/**
 * /admin/schools/[id] — a school's own management hub, «انگار وارد پنل مدیر همان مدرسه شده‌ای» (owner): the آمار row
 * (کلاس‌ها/دانش‌آموزان/کارکنان, each a jump to its section on this page), سال تحصیلی (the fixed catalog — shown, not
 * edited), this school's کلاس‌ها, کارکنان and دانش‌آموزان (a compact list each, the same row as the full list, and
 * the door to that list filtered to this school), برنامهٴ کلاسی and the ارائهٴ درس summary. There is no شعبه
 * here (an internal, always-one detail). Scope: a school outside the caller's scope is NOT_FOUND (`schoolHubQuery`).
 */
export default async function SchoolHubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const result = await schoolHubQuery({ schoolId: id });
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const d = result.data;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={<bdi>{d.school.name}</bdi>}
        description={<SchoolHubFacts code={d.school.code} genderLabel={GENDER_LABELS[d.school.genderPolicy ?? ""] ?? null} yearName={d.focusYear?.name ?? null} />}
        back={{ href: "/admin/schools", label: d.backLabelFa }}
        actions={
          d.can.school ? (
            <ResourceForm resource={schoolResource.key} labelFa="مشخصات" fields={schoolResource.formFields} options={{}} mode="edit" id={d.school.id} initial={{ name: d.school.name, genderPolicy: d.school.genderPolicy, isDefault: d.school.isDefault }} />
          ) : null
        }
      />

      <Stats d={d} />
      <Years d={d} />
      <Classes d={d} />
      <Staff d={d} />
      <Students d={d} />
      <Periods d={d} />
      <Offerings d={d} />
    </div>
  );
}

/** آمار مدرسه: three counters of THIS school, each a jump to its section below (the filtered list when there is none). */
function Stats({ d }: { d: SchoolHubData }) {
  const tiles: Array<{ href: string; label: string; value: number }> = [
    { href: "#classes", label: "کلاس‌ها", value: d.counts.classes },
    { href: d.students ? "#students" : `/admin/students?school=${d.school.id}`, label: "دانش‌آموزان", value: d.counts.students },
    { href: d.staff ? "#staff" : `/admin/staff?school=${d.school.id}`, label: "کارکنان", value: d.counts.staff },
  ];
  return (
    <ul className="surface-panel grid grid-cols-3">
      {tiles.map((t, i) => (
        <li key={t.label} className={i > 0 ? "border-s border-line" : ""}>
          <Link href={t.href} className="pressable flex min-h-20 flex-col justify-center gap-0.5 px-4 py-3 hover:bg-surface">
            <span className="tabular text-title font-extrabold text-text">{n(t.value)}</span>
            <span className="text-meta text-text-muted">{t.label}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** This school's active classes; each row opens the class page where its دانش‌آموزان/ارائه/برنامه are managed. */
function Classes({ d }: { d: SchoolHubData }) {
  const addBtn = d.can.classes ? (
    <Button asChild variant="ghost" size="sm">
      <Link href="/admin/classes">
        <Plus className="size-4" aria-hidden />
        کلاس جدید
      </Link>
    </Button>
  ) : null;
  return (
    <PageSection id="classes" title="کلاس‌ها" icon={Users} count={d.classes.length} surface="work" flush trailing={addBtn}>
      {d.classes.length === 0 ? (
        <NotYet what="این مدرسه هنوز کلاسی ندارد. کلاس‌ها را از «کلاس‌ها»ی مدیریت بسازید." action={addBtn} />
      ) : (
        <List>
          {d.classes.map((c) => (
            <li key={c.id}>
              <Link prefetch={false} href={`/admin/classes/${c.id}`} className="surface-link pressable flex min-h-12 items-center gap-3 px-4 py-2">
                <RowMark icon={GraduationCap} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-row font-medium text-text">
                    <bdi>{c.name}</bdi>
                  </span>
                  <span className="truncate text-meta text-text-muted">
                    {c.gradeName}
                    <span aria-hidden className="text-text-faint"> · </span>
                    {c.yearName}
                  </span>
                </span>
                <span className="tabular shrink-0 text-meta text-text-muted">{n(c.students)} دانش‌آموز</span>
                <ChevronLeft className="size-4 shrink-0 text-text-faint" aria-hidden />
              </Link>
            </li>
          ))}
        </List>
      )}
    </PageSection>
  );
}

/** «همه» — the door from a compact hub list to the full list, filtered to this school. */
function AllLink({ href, total, shown }: { href: string; total: number; shown: number }) {
  if (total === 0) return null;
  return (
    <Button asChild variant="ghost" size="sm">
      <Link href={href}>
        {total > shown ? `همهٴ ${n(total)} نفر` : "فهرست کامل"}
        <ChevronLeft className="size-4" aria-hidden />
      </Link>
    </Button>
  );
}

/** کارکنان of THIS school (anchored to it — `staff_profile.school_id`): the first rows of /admin/staff?school=. */
function Staff({ d }: { d: SchoolHubData }) {
  if (!d.staff) return null;
  return (
    <PageSection id="staff" title="کارکنان" icon={UsersRound} count={d.staff.total} surface="work" flush trailing={<AllLink href={`/admin/staff?school=${d.school.id}`} total={d.staff.total} shown={d.staff.rows.length} />}>
      {d.staff.rows.length === 0 ? (
        <NotYet what="همکاری با مدرسهٴ اصلیِ این مدرسه ثبت نشده. همکاران را از «کارکنان»ِ مدیریت ثبت کنید." />
      ) : (
        <List>
          {d.staff.rows.map((r) => (
            <StaffRow key={r.personId} row={r} />
          ))}
        </List>
      )}
    </PageSection>
  );
}

/** دانش‌آموزان of THIS school (enrolled in it): the first rows of /admin/students?school=. */
function Students({ d }: { d: SchoolHubData }) {
  if (!d.students) return null;
  return (
    <PageSection
      id="students"
      title="دانش‌آموزان"
      icon={GraduationCap}
      count={d.students.total}
      surface="work"
      flush
      trailing={<AllLink href={`/admin/students?school=${d.school.id}`} total={d.students.total} shown={d.students.rows.length} />}
    >
      {d.students.rows.length === 0 ? (
        <NotYet what="دانش‌آموزی در این مدرسه ثبت‌نام نشده. دانش‌آموزان را از «دانش‌آموزان»ِ مدیریت ثبت کنید." />
      ) : (
        <List>
          {d.students.rows.map((r) => (
            <StudentRow key={r.personId} row={r} />
          ))}
        </List>
      )}
    </PageSection>
  );
}

/** One link into the school's زنگ‌بندی (bell schedule) editor. */
function Periods({ d }: { d: SchoolHubData }) {
  return (
    <ul className="surface-work overflow-hidden rounded-card">
      <li>
        <Link href={`/admin/schools/${d.school.id}/periods`} className="surface-link pressable flex min-h-14 items-center gap-3 px-4 py-2">
          <RowMark icon={CalendarClock} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-row font-medium text-text">برنامهٴ کلاسی</span>
            <span className="text-meta text-text-muted">ساعت شروع و پایان هر زنگ این مدرسه</span>
          </span>
          <ChevronLeft className="size-4 shrink-0 text-text-faint" aria-hidden />
        </Link>
      </li>
    </ul>
  );
}

/** One 44 px row of a hub list: a title, a quiet meta line, an optional trailing note. Neither remaining list links out anymore. */
function Row({ title, meta, trailing }: { title: React.ReactNode; meta?: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <li className="flex items-center">
      <span className="flex min-h-12 w-full items-center gap-3 px-4 py-2">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-row font-medium text-text">{title}</span>
          {meta ? <span className="truncate text-meta text-text-muted">{meta}</span> : null}
        </span>
        {trailing ? <span className="flex shrink-0 items-center gap-2 text-meta text-text-muted">{trailing}</span> : null}
      </span>
    </li>
  );
}

/** «هنوز تعریف نشده» — one line and the section's own primary action, so a fresh school is filled in from here. */
function NotYet({ what, action }: { what: string; action?: React.ReactNode }) {
  return <EmptyState title="هنوز تعریف نشده" description={what} action={action} className="py-8" />;
}

function List({ children }: { children: React.ReactNode }) {
  // `overflow-hidden` keeps a row's hover tint inside the card's 16 px corners (the section box is `flush`).
  return <ul className="divide-y divide-line/70 overflow-hidden rounded-card">{children}</ul>;
}

/**
 * سال تحصیلی — نام، بازه، «جاری». Read-only: years are the FIXED catalog (۱۴۰۵-۱۴۰۶, ۱۴۰۶-۱۴۰۷ — written by the
 * catalog seed and when a school is created), so there is no «سال تحصیلی جدید» here any more. نوبت‌ها are not shown.
 */
function Years({ d }: { d: SchoolHubData }) {
  return (
    <PageSection id="years" title="سال تحصیلی" icon={CalendarDays} count={d.years.length} surface="work" flush>
      {d.years.length === 0 ? (
        <NotYet what="سال تحصیلی این مدرسه با به‌روزرسانی بعدی سامانه اضافه می‌شود." />
      ) : (
        <List>
          {d.years.map((y) => (
            <Row
              key={y.id}
              title={<bdi>{y.name}</bdi>}
              meta={
                <span className="tabular">
                  {isoDateToJalali(y.startsOn)} – {isoDateToJalali(y.endsOn)}
                </span>
              }
              trailing={y.isCurrent ? <Chip tone="primary">جاری</Chip> : null}
            />
          ))}
        </List>
      )}
    </PageSection>
  );
}

function Offerings({ d }: { d: SchoolHubData }) {
  return (
    <PageSection id="offerings" title="ارائهٴ درس" icon={BookOpen} surface="panel">
      {d.offerings.total === 0 ? (
        <NotYet what="درس، نوبت و دبیر هر کلاس در صفحهٴ همان کلاس تعریف می‌شود." />
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text">
            <span className="tabular">{n(d.offerings.total)}</span> ارائهٴ درس فعال
            {d.offerings.withoutTeacher > 0 ? (
              <>
                <span aria-hidden className="text-text-faint"> · </span>
                <span className="text-warning-text">
                  <span className="tabular">{n(d.offerings.withoutTeacher)}</span> بدون دبیر
                </span>
              </>
            ) : null}
          </p>
          <p className="text-meta text-text-muted">از صفحهٴ هر کلاس، «ارائهٴ درس‌ها».</p>
        </div>
      )}
    </PageSection>
  );
}
