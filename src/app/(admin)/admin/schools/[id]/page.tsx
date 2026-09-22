import { BookOpen, CalendarDays, ChevronLeft, Clock, Layers, Users, UsersRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageSection } from "@/components/layout/PageSection";
import { TwoColumn } from "@/components/layout/TwoColumn";
import { ResourceForm } from "@/components/admin/ResourceForm";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { RowMark } from "@/components/RowMark";
import { Button } from "@/components/ui/button";
import { formFieldsOf } from "@/lib/admin/defineResource";
import { branchResource, classResource, GENDER_LABELS, schoolResource, termResource, yearResource } from "@/lib/admin/resources";
import { schoolHubQuery, type SchoolHubData } from "@/lib/admin/school-queries";
import { formatNumberFa, isoDateToJalali, toFaDigits } from "@/lib/format";

export const metadata: Metadata = { title: "مدرسه | مدیریت" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const n = formatNumberFa;

/**
 * /admin/schools/[id] — the school hub: ONE page where a school is set up top to bottom (شعبه‌ها → سال تحصیلی و
 * نوبت‌ها → زنگ‌بندی → کلاس‌ها → ارائهٴ درس → کارکنان) instead of seven list pages. Every «افزودن» opens the SAME
 * dialog its list page opens — the resource definition, the strict schema and `adminResourceMutate` are shared, so
 * nothing is validated twice. The زنگ‌بندی editor keeps its own page (the grid needs the room); this page links to
 * it. Scope: a school outside the caller's scope is NOT_FOUND (`schoolHubQuery`).
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
  const facts = [
    <bdi key="code" dir="ltr">
      {d.school.code}
    </bdi>,
    GENDER_LABELS[d.school.genderPolicy ?? ""] ?? null,
    d.branches.length > 1 ? `${n(d.branches.length)} شعبه` : null,
    d.focusYear?.name ?? null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={<bdi>{d.school.name}</bdi>}
        description={
          <span className="flex flex-wrap items-center gap-x-1.5">
            {facts.map((f, i) => (
              <span key={i}>
                {i > 0 ? <span aria-hidden className="text-text-faint"> · </span> : null}
                {f}
              </span>
            ))}
          </span>
        }
        back={{ href: "/admin/schools", label: "مدرسه‌ها" }}
        actions={
          d.can.school ? (
            <ResourceForm resource={schoolResource.key} labelFa="مشخصات" fields={schoolResource.formFields} options={{}} mode="edit" id={d.school.id} initial={{ name: d.school.name, genderPolicy: d.school.genderPolicy, isDefault: d.school.isDefault }} />
          ) : null
        }
      />

      <TwoColumn
        asideWidth="wide"
        main={
          <>
            <Branches d={d} />
            <Years d={d} />
            <Classes d={d} />
          </>
        }
        aside={
          <>
            <Periods d={d} />
            <Offerings d={d} />
            <Staff d={d} />
            {d.isOrgAdmin ? <Catalog /> : null}
          </>
        }
      />
    </div>
  );
}

/** One 44 px row of a hub list: a title, a quiet meta line, an optional trailing note, linked when it has a page. */
function Row({ href, title, meta, trailing }: { href?: string; title: React.ReactNode; meta?: React.ReactNode; trailing?: React.ReactNode }) {
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-row font-medium text-text">{title}</span>
        {meta ? <span className="truncate text-meta text-text-muted">{meta}</span> : null}
      </span>
      {trailing ? <span className="flex shrink-0 items-center gap-2 text-meta text-text-muted">{trailing}</span> : null}
      {href ? <ChevronLeft className="size-4 shrink-0 text-text-faint" aria-hidden /> : null}
    </>
  );
  return (
    <li className="flex items-center">
      {href ? (
        <Link href={href} className="pressable flex min-h-12 w-full items-center gap-3 px-4 py-2 hover:bg-surface-sunken">
          {body}
        </Link>
      ) : (
        <span className="flex min-h-12 w-full items-center gap-3 px-4 py-2">{body}</span>
      )}
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

function Branches({ d }: { d: SchoolHubData }) {
  // The school id travels as a `fixed` value and its picker leaves the form: on this page the school is the page.
  // The heading's trigger is quiet (four sections offer one each); the same form is the primary button of an empty state.
  const form = (tone: "primary" | "quiet") =>
    d.can.structure ? (
      <ResourceForm
        resource={branchResource.key}
        labelFa={branchResource.labelFa}
        fields={branchResource.formFields.filter((f) => f.name !== "schoolId")}
        options={{}}
        mode="create"
        tone={tone}
        fixed={{ schoolId: d.school.id }}
      />
    ) : null;
  return (
    <PageSection id="branches" title="شعبه‌ها" icon={Layers} count={d.branches.length} surface="work" flush trailing={form("quiet")}>
      {d.branches.length === 0 ? (
        <NotYet what="هر مدرسه دست‌کم یک شعبه دارد." action={form("primary")} />
      ) : (
        <List>
          {d.branches.map((b) => (
            <Row key={b.id} title={<bdi>{b.name}</bdi>} meta={b.address ?? undefined} trailing={b.isDefault ? <Chip tone="neutral">پیش‌فرض</Chip> : null} />
          ))}
        </List>
      )}
    </PageSection>
  );
}

function Years({ d }: { d: SchoolHubData }) {
  const yearForm = (tone: "primary" | "quiet") =>
    d.can.structure ? (
      <ResourceForm resource={yearResource.key} labelFa={yearResource.labelFa} fields={yearResource.formFields.filter((f) => f.name !== "schoolId")} options={{}} mode="create" tone={tone} fixed={{ schoolId: d.school.id }} />
    ) : null;
  const termForm =
    d.can.structure && d.focusYear ? (
      <ResourceForm resource={termResource.key} labelFa={termResource.labelFa} fields={termResource.formFields} options={{}} mode="create" tone="quiet" fixed={{ academicYearId: d.focusYear.id }} />
    ) : null;
  return (
    <PageSection id="years" title="سال تحصیلی" icon={CalendarDays} count={d.years.length} surface="work" flush trailing={yearForm("quiet")}>
      {d.years.length === 0 ? (
        <NotYet what="بدون سال تحصیلی جاری نمی‌توان کلاس ساخت." action={yearForm("primary")} />
      ) : (
        <>
          <List>
            {d.years.map((y) => (
              <Row
                key={y.id}
                href={`/admin/terms?year=${y.id}`}
                title={<bdi>{y.name}</bdi>}
                meta={
                  <span className="tabular">
                    {isoDateToJalali(y.startsOn)} – {isoDateToJalali(y.endsOn)}
                  </span>
                }
                trailing={y.isCurrent ? <Chip tone="primary">جاری</Chip> : `${n(y.terms)} نوبت`}
              />
            ))}
          </List>
          {d.focusYear ? (
            <div className="border-t border-line bg-surface-sunken/60 px-4 py-3">
              <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
                <h3 className="text-meta font-semibold text-text-muted">
                  نوبت‌های <bdi>{d.focusYear.name}</bdi>
                </h3>
                {termForm}
              </div>
              {d.focusYear.terms.length === 0 ? (
                <p className="py-2 text-sm text-text-muted">هنوز تعریف نشده — هر ارائهٴ درس به یک نوبت وصل است.</p>
              ) : (
                <ul className="flex flex-wrap gap-2 pt-1">
                  {d.focusYear.terms.map((t) => (
                    <li key={t.id} className="rounded-full border border-line bg-surface px-3 py-1 text-meta text-text">
                      <bdi>{t.name}</bdi>
                      <span className="tabular text-text-muted">
                        {" "}
                        {isoDateToJalali(t.startsOn)} – {isoDateToJalali(t.endsOn)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </>
      )}
    </PageSection>
  );
}

function Classes({ d }: { d: SchoolHubData }) {
  const form = (tone: "primary" | "quiet") =>
    d.can.classes && d.focusYear ? (
      <ResourceForm resource={classResource.key} labelFa={classResource.labelFa} fields={formFieldsOf(classResource, d.options.class)} options={d.options.class} mode="create" tone={tone} />
    ) : null;
  return (
    <PageSection id="classes" title="کلاس‌ها" icon={Users} count={d.classes.length} surface="work" flush trailing={form("quiet")}>
      {d.classes.length === 0 ? (
        <NotYet what={d.focusYear ? "کلاس = پایه + نام، در سال تحصیلی جاری." : "اول سال تحصیلی را تعریف کنید."} action={form("primary")} />
      ) : (
        <>
          <List>
            {d.classes.map((c) => (
              <Row
                key={c.id}
                href={`/admin/classes/${c.id}`}
                title={<bdi>{c.name}</bdi>}
                meta={
                  <>
                    {c.gradeName}
                    {d.branches.length > 1 ? ` · ${c.branchName}` : ""}
                  </>
                }
                trailing={<span className="tabular">{n(c.students)} دانش‌آموز</span>}
              />
            ))}
          </List>
          <p className="border-t border-line px-4 py-2 text-meta text-text-muted">
            روی هر کلاس: دانش‌آموزان، ارائهٴ درس‌ها و برنامهٴ هفتگی. <span className="tabular">{n(d.students)}</span> دانش‌آموز در این مدرسه.
          </p>
        </>
      )}
    </PageSection>
  );
}

function Periods({ d }: { d: SchoolHubData }) {
  const first = d.periods[0];
  const last = d.periods[d.periods.length - 1];
  return (
    <PageSection id="periods" title="زنگ‌بندی" icon={Clock} surface="panel">
      {d.periods.length === 0 ? (
        <NotYet
          what="برنامهٴ هفتگی هر کلاس روی زنگ‌های همین مدرسه چیده می‌شود."
          action={
            <Button asChild>
              <Link href={`/admin/schools/${d.school.id}/periods`}>تعریف زنگ‌بندی</Link>
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text">
            <span className="tabular">{n(d.periods.length)}</span> زنگ
            {first && last ? (
              <>
                <span aria-hidden className="text-text-faint"> · </span>
                <bdi dir="ltr" className="tabular">
                  {toFaDigits(first.startsAt)}–{toFaDigits(last.endsAt)}
                </bdi>
              </>
            ) : null}
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {d.periods.map((p) => (
              <li key={p.id} className="rounded-full bg-surface px-2.5 py-1 text-meta text-text-muted ring-1 ring-inset ring-line">
                <bdi>{p.label}</bdi>{" "}
                <bdi dir="ltr" className="tabular">
                  {toFaDigits(p.startsAt)}
                </bdi>
              </li>
            ))}
          </ul>
          <Button asChild variant="outline" className="self-start">
            <Link href={`/admin/schools/${d.school.id}/periods`}>ویرایش زنگ‌بندی</Link>
          </Button>
        </div>
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

function Staff({ d }: { d: SchoolHubData }) {
  return (
    <PageSection id="staff" title="کارکنان" icon={UsersRound} surface="panel">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text">
          {d.staff === 0 ? (
            "هنوز همکاری به این مدرسه وصل نیست."
          ) : (
            <>
              <span className="tabular">{n(d.staff)}</span> همکار با مدرسهٴ اصلی «<bdi>{d.school.name}</bdi>»
            </>
          )}
        </p>
        <Button asChild variant="outline" className="self-start">
          <Link href={`/admin/staff?school=${d.school.id}`}>کارکنان این مدرسه</Link>
        </Button>
      </div>
    </PageSection>
  );
}

/** پایه‌ها, درس‌ها and مقطع‌ها belong to the organization, not to one school — one quiet row out to them. */
function Catalog() {
  const links = [
    { href: "/admin/grades", labelFa: "پایه‌ها", icon: Layers },
    { href: "/admin/subjects", labelFa: "درس‌ها", icon: BookOpen },
    { href: "/admin/levels", labelFa: "مقطع‌ها", icon: Layers },
  ];
  return (
    <PageSection id="catalog" title="کاتالوگ سازمان" surface="panel" flush>
      <ul className="divide-y divide-line/70">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="pressable flex min-h-12 items-center gap-3 px-4 py-2 hover:bg-surface">
              <RowMark icon={l.icon} />
              <span className="flex-1 text-row text-text">{l.labelFa}</span>
              <ChevronLeft className="size-4 shrink-0 text-text-faint" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <p className="px-4 pb-3 text-meta text-text-muted">مشترک میان همهٴ مدرسه‌های سازمان.</p>
    </PageSection>
  );
}
