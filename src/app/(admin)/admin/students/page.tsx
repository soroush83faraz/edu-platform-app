import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cn } from "cn";
import { Pagination, SearchForm, lastPage } from "@/components/admin/AdminPage";
import { PageHeader } from "@/components/layout/PageHeader";
import { one, type SearchParams } from "@/components/admin/ResourceListPage";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { requireContext } from "@/lib/ctx";
import { formatNumberFa, toFaDigits } from "@/lib/format";
import { studentsListQuery } from "@/lib/admin/people-queries";
import { canAtAnyScope } from "@/modules/iam/can";

export const metadata: Metadata = { title: "دانش‌آموزان | مدیریت" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function StudentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 80);
  const page = Math.max(1, Number.parseInt(one(sp.page) || "1", 10) || 1);
  const pending = one(sp.pending) === "1";
  const noClass = one(sp.noclass) === "1";
  const schoolId = UUID_RE.test(one(sp.school)) ? one(sp.school) : undefined;
  const ctx = await requireContext();
  const result = await studentsListQuery({ q, page, pending, noClass, schoolId });
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const { rows, total, pageSize, school } = result.data;
  const canWrite = canAtAnyScope(ctx.assignments, "iam.person.write");
  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { q, pending: pending ? "1" : undefined, noclass: noClass ? "1" : undefined, school: schoolId, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/admin/students${s ? `?${s}` : ""}`;
  };
  // `?page=99` beyond the end: clamp to the last page instead of an empty list.
  if (page > lastPage(total, pageSize)) redirect(href({ page: lastPage(total, pageSize) > 1 ? String(lastPage(total, pageSize)) : undefined }));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="دانش‌آموزان"
        count={`${formatNumberFa(total)} نفر`}
        back={school ? { href: `/admin/schools/${school.id}`, label: school.name } : undefined}
        description="ثبت دانش‌آموز با حساب کاربری و کلاس در یک فرم؛ رمز اولیه فقط یک‌بار نمایش داده می‌شود و بعداً از صفحهٴ کلاس چاپ می‌شود."
        actions={
          canWrite ? (
            <Button asChild>
              <Link href="/admin/students/new">
                <Plus className="size-4" aria-hidden />
                دانش‌آموز جدید
              </Link>
            </Button>
          ) : null
        }
      />
      {school ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
          فقط دانش‌آموزان <bdi className="font-medium text-text">{school.name}</bdi>
          <Link href="/admin/students" className="inline-flex min-h-11 items-center text-primary-700 hover:underline">
            همهٴ دانش‌آموزان
          </Link>
        </p>
      ) : null}
      <SearchForm q={q} hidden={{ pending: pending ? "1" : undefined, noclass: noClass ? "1" : undefined, school: schoolId }} placeholder="نام یا شمارهٴ دانش‌آموزی" />
      <div className="flex flex-wrap gap-2 text-sm">
        <FilterChip href={href({ pending: undefined, noclass: undefined, page: undefined })} active={!pending && !noClass} label="همهٴ دانش‌آموزان" />
        <FilterChip href={href({ pending: "1", noclass: undefined, page: undefined })} active={pending} label="حساب فعال‌نشده" />
        <FilterChip href={href({ noclass: "1", pending: undefined, page: undefined })} active={noClass} label="بدون کلاس" />
      </div>
      {rows.length === 0 ? (
        <EmptyState title={q || pending || noClass ? "دانش‌آموزی با این شرط پیدا نشد" : "هنوز دانش‌آموزی ثبت نشده"} description={canWrite && !(q || pending || noClass) ? "با «دانش‌آموز جدید» یا ورود از اکسل شروع کنید." : undefined} className="surface-work py-10" />
      ) : (
        <ul className="surface-work divide-y divide-line/70">
          {rows.map((r) => (
            <li key={r.personId}>
              <Link href={`/admin/people/${r.personId}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 hover:bg-surface-sunken">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-row font-medium text-text">
                    <bdi>
                      {r.firstName} {r.lastName}
                    </bdi>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 text-meta text-text-muted">
                    <bdi dir="ltr" className="tabular">
                      {toFaDigits(r.studentNumber)}
                    </bdi>
                    {r.className ? <bdi>{r.className}</bdi> : <span className="text-warning-text">بدون کلاس</span>}
                    {r.schoolName ? <span className="hidden sm:inline">{r.schoolName}</span> : null}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {r.loginIdentifier === null ? <Chip tone="neutral">بدون حساب</Chip> : r.accountStatus === "locked" ? <Chip tone="danger">قفل</Chip> : r.mustChangePassword ? <Chip tone="warning">رمز اولیه</Chip> : <Chip tone="success">فعال</Chip>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} pageSize={pageSize} total={total} href={(p) => href({ page: String(p) })} />
    </div>
  );
}

function FilterChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link href={href} aria-pressed={active} className={cn("inline-flex min-h-11 items-center rounded-full border px-3 transition-base md:min-h-9", active ? "border-primary-600 bg-primary-50 font-semibold text-primary-700" : "border-line bg-surface text-text-muted hover:border-line-strong")}>
      {label}
    </Link>
  );
}
