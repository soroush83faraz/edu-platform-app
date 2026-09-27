import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Pagination, SearchForm, lastPage } from "@/components/admin/AdminPage";
import { StudentRow } from "@/components/admin/PeopleRows";
import { PageHeader } from "@/components/layout/PageHeader";
import { one, type SearchParams } from "@/components/admin/ResourceListPage";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { requireContext } from "@/lib/ctx";
import { formatNumberFa } from "@/lib/format";
import { studentsListQuery } from "@/lib/admin/people-queries";
import { canAtAnyScope } from "@/modules/iam/can";

export const metadata: Metadata = { title: "دانش‌آموزان | مدیریت" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /admin/students — one list with search, no filter tabs (owner, 2026-09-27): whether a student has a class or has
 * activated their account is a fact IN the row («بدون کلاس», «حساب فعال نشده»), not a tab above it. The links of
 * «نیازمند توجه» (`?pending=1`, `?noclass=1`) and of a school hub (`?school=`) still narrow the list; the narrowing
 * is named in one line with its way back to the whole list.
 */
export default async function StudentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 80);
  const page = Math.max(1, Number.parseInt(one(sp.page) || "1", 10) || 1);
  const pending = one(sp.pending) === "1";
  const noClass = !pending && one(sp.noclass) === "1";
  const schoolId = UUID_RE.test(one(sp.school)) ? one(sp.school) : undefined;
  const ctx = await requireContext();
  const result = await studentsListQuery({ q, page, pending, noClass, schoolId });
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const { rows, total, pageSize, school } = result.data;
  const canWrite = canAtAnyScope(ctx.assignments, "iam.person.write");
  const kept = { pending: pending ? "1" : undefined, noclass: noClass ? "1" : undefined, school: schoolId };
  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, ...kept, ...over })) if (v) p.set(k, v);
    const s = p.toString();
    return `/admin/students${s ? `?${s}` : ""}`;
  };
  // `?page=99` beyond the end: clamp to the last page instead of an empty list.
  if (page > lastPage(total, pageSize)) redirect(href({ page: lastPage(total, pageSize) > 1 ? String(lastPage(total, pageSize)) : undefined }));
  const narrowed = pending ? "فقط حساب‌های فعال‌نشده" : noClass ? "فقط دانش‌آموزان بدون کلاس" : null;

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
      {school || narrowed ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
          {narrowed ?? "فقط دانش‌آموزان"}
          {school ? <bdi className="font-medium text-text">{school.name}</bdi> : null}
          <Link href="/admin/students" className="inline-flex min-h-11 items-center text-primary-700 hover:underline">
            همهٴ دانش‌آموزان
          </Link>
        </p>
      ) : null}
      <SearchForm q={q} hidden={kept} placeholder="نام یا شمارهٴ دانش‌آموزی" />
      {rows.length === 0 ? (
        <EmptyState
          title={q || narrowed ? "دانش‌آموزی با این شرط پیدا نشد" : "هنوز دانش‌آموزی ثبت نشده"}
          description={canWrite && !(q || narrowed) ? "با «دانش‌آموز جدید» یا ورود از اکسل شروع کنید." : undefined}
          className="surface-work py-10"
        />
      ) : (
        <ul className="surface-work divide-y divide-line/70">
          {rows.map((r) => (
            <StudentRow key={r.personId} row={r} />
          ))}
        </ul>
      )}
      <Pagination page={page} pageSize={pageSize} total={total} href={(p) => href({ page: String(p) })} />
    </div>
  );
}
