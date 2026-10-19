import { ChevronLeft, MessageSquareText, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cn } from "@/lib/cn";
import { SearchForm } from "@/components/admin/AdminPage";
import { EmptyState } from "@/components/EmptyState";
import { RowMark } from "@/components/RowMark";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { formatNumberFa, toFaDigits } from "@/lib/format";
import { counselingStudentsQuery } from "@/modules/counseling/queries";
import { addressedMessagesQuery } from "@/modules/iam/guardian-message-queries";
import { COUNSELOR_MESSAGES_HREF } from "@/modules/iam/guardian-messages";

export const metadata: Metadata = { title: "مشاوره" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

/**
 * «مشاوره» (Home tile; owner 2026-10-13): the students of one school of the viewer's reach — the counselor's own
 * school, a principal's or vice principal's, any school for the organization admin (`?school=` switches) — grouped by
 * پایه in the پایه's order, with the class and the student number, searchable by name or number. One white box, a
 * quiet header per پایه with its head count; every row opens the student's «پروندهٴ مشاوره».
 */
export default async function CounselingPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const q = one(sp.q).trim().slice(0, 80);
  const schoolParam = one(sp.school);
  const schoolId = UUID_RE.test(schoolParam) ? schoolParam : undefined;
  const result = await counselingStudentsQuery({ schoolId, q: q || undefined });
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const { schools, school, groups, total, truncated } = result.data;
  // A counselor (`counseling.note.write`) reads and answers the guardians' messages given to them here — they have no
  // «پنل من». Anyone else gets FORBIDDEN from the query and no row.
  const messages = await addressedMessagesQuery();
  const openMessages = messages.ok ? messages.data.filter((m) => m.open).length : 0;
  const hrefOf = (over: { school?: string; q?: string }) => {
    const p = new URLSearchParams();
    const s = over.school ?? school?.id;
    if (s && schools.length > 1) p.set("school", s);
    if (over.q) p.set("q", over.q);
    const str = p.toString();
    return `/counseling${str ? `?${str}` : ""}`;
  };

  return (
    <ContentWidth className="reveal-stagger">
      <PageHeader
        title="مشاوره"
        count={`${formatNumberFa(total)} دانش‌آموز`}
        description={
          school ? (
            <>
              پروندهٴ مشاورهٴ دانش‌آموزان <bdi>{school.name}</bdi>
            </>
          ) : undefined
        }
      />

      {schools.length > 1 ? (
        <nav aria-label="مدرسه" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          <ul className="flex w-max min-w-full gap-1.5">
            {schools.map((s) => {
              const current = s.id === school?.id;
              return (
                <li key={s.id}>
                  <Link
                    prefetch={false}
                    href={hrefOf({ school: s.id })}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "pressable inline-flex min-h-11 items-center rounded-xl border px-3 text-sm whitespace-nowrap",
                      current ? "border-primary-600/40 bg-primary-50 text-primary-800" : "border-line bg-surface text-text-muted hover:bg-surface-sunken",
                    )}
                  >
                    <bdi>{s.name}</bdi>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}

      {messages.ok ? (
        <Link prefetch={false} href={COUNSELOR_MESSAGES_HREF} className="surface-link pressable surface-panel flex min-h-12 items-center gap-3 px-4 py-2 text-sm font-medium text-text">
          <RowMark icon={MessageSquareText} />
          <span className="min-w-0 flex-1 truncate">پیام‌های اولیا</span>
          {openMessages > 0 ? <span className="tabular text-meta font-normal text-text-muted">{formatNumberFa(openMessages)} در انتظار پاسخ</span> : null}
          <ChevronLeft className="size-4 shrink-0 text-text-faint" aria-hidden />
        </Link>
      ) : null}

      <SearchForm q={q} hidden={{ school: schools.length > 1 ? school?.id : undefined }} placeholder="نام یا شمارهٴ دانش‌آموزی" />

      {groups.length === 0 ? (
        <EmptyState
          className="surface-work"
          title={q ? "دانش‌آموزی با این نام یا شماره پیدا نشد" : "این مدرسه هنوز دانش‌آموزی ندارد"}
          description={q ? "نام را کوتاه‌تر یا شمارهٴ دانش‌آموزی را کامل بنویسید." : "دانش‌آموزان پس از ثبت‌نام در مدرسه این‌جا می‌آیند."}
        />
      ) : (
        <div className="surface-work overflow-hidden">
          {groups.map((g) => (
            <section key={g.key} aria-labelledby={`grade-${g.key}`}>
              <h3 id={`grade-${g.key}`} className="flex min-h-10 items-center justify-between gap-3 border-b border-line/70 bg-surface-sunken px-4 text-sm font-semibold text-text">
                <span>{g.gradeName ? `پایهٴ ${g.gradeName}` : "بدون پایه"}</span>
                <span className="tabular text-meta font-normal text-text-muted">{formatNumberFa(g.students.length)} دانش‌آموز</span>
              </h3>
              <ul className="divide-y divide-line/70">
                {g.students.map((s) => (
                  <li key={s.studentProfileId}>
                    <Link prefetch={false} href={`/counseling/students/${s.studentProfileId}`} className="surface-link pressable flex min-h-14 items-center gap-3 px-4 py-2">
                      <RowMark icon={UserRound} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-row font-medium text-text">
                          <bdi>
                            {s.firstName} {s.lastName}
                          </bdi>
                        </span>
                        <span className="truncate text-meta text-text-muted">
                          {s.classGroupName ? (
                            <>
                              کلاس <bdi>{s.classGroupName}</bdi>
                            </>
                          ) : (
                            "بدون کلاس"
                          )}
                          {" · "}
                          <bdi dir="ltr" className="tabular">
                            {toFaDigits(s.studentNumber)}
                          </bdi>
                        </span>
                      </span>
                      <ChevronLeft className="size-4 shrink-0 text-text-faint" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {truncated ? <p className="text-meta text-text-muted">فهرست بلند است؛ برای یافتن دانش‌آموز نام یا شماره را جست‌وجو کنید.</p> : null}
    </ContentWidth>
  );
}
