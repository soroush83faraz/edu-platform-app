import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Pagination, SearchForm, lastPage } from "@/components/admin/AdminPage";
import { PageHeader } from "@/components/layout/PageHeader";
import { one, type SearchParams } from "@/components/admin/ResourceListPage";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { requireContext } from "@/lib/ctx";
import { formatLoginIdentifierFa, formatNumberFa } from "@/lib/format";
import { staffListQuery } from "@/lib/admin/people-queries";
import { canAtAnyScope } from "@/modules/iam/can";

export const metadata: Metadata = { title: "کارکنان | مدیریت" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function StaffPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 80);
  const page = Math.max(1, Number.parseInt(one(sp.page) || "1", 10) || 1);
  // «کارکنان این مدرسه» from the school hub: the list keeps the filter through search and pagination.
  const schoolId = UUID_RE.test(one(sp.school)) ? one(sp.school) : undefined;
  const ctx = await requireContext();
  const result = await staffListQuery({ q, page, schoolId });
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const { rows, total, pageSize, school } = result.data;
  const canWrite = canAtAnyScope(ctx.assignments, "iam.person.write");
  const hrefFor = (p: number) => `/admin/staff?${new URLSearchParams({ ...(q ? { q } : {}), ...(schoolId ? { school: schoolId } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;
  if (page > lastPage(total, pageSize)) redirect(hrefFor(lastPage(total, pageSize)));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="کارکنان"
        count={`${formatNumberFa(total)} نفر`}
        back={school ? { href: `/admin/schools/${school.id}`, label: school.name } : undefined}
        description="دبیران و کادر. حساب کاربری با شمارهٴ موبایل ساخته می‌شود؛ نقش «معلم» از تخصیص درس در صفحهٴ کلاس می‌آید."
        actions={
          canWrite ? (
            <Button asChild>
              <Link href="/admin/staff/new">
                <Plus className="size-4" aria-hidden />
                همکار جدید
              </Link>
            </Button>
          ) : null
        }
      />
      {school ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
          فقط کارکنان <bdi className="font-medium text-text">{school.name}</bdi>
          <Link href="/admin/staff" className="inline-flex min-h-11 items-center text-primary-700 hover:underline">
            همهٴ کارکنان
          </Link>
        </p>
      ) : null}
      <SearchForm q={q} hidden={{ school: schoolId }} placeholder="نام همکار" />
      {rows.length === 0 ? (
        <EmptyState title={q ? "همکاری با این نام پیدا نشد" : "هنوز همکاری ثبت نشده"} description={canWrite && !q ? "با «همکار جدید» شروع کنید." : undefined} className="surface-work py-10" />
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
                    {r.loginIdentifier ? (
                      <bdi dir="ltr" className="tabular">
                        {formatLoginIdentifierFa(r.loginIdentifier)}
                      </bdi>
                    ) : null}
                    {r.roles.map((x) => (
                      <span key={x}>{x}</span>
                    ))}
                    {r.teaching > 0 ? <span>{formatNumberFa(r.teaching)} درس</span> : null}
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
      <Pagination page={page} pageSize={pageSize} total={total} href={hrefFor} />
    </div>
  );
}
