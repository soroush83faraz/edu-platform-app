import { ChevronLeft, ClipboardList, NotebookPen, Phone, Send } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cn } from "@/lib/cn";
import { Chip, type ChipTone } from "@/components/Chip";
import { RelativeTime } from "@/components/RelativeTime";
import { ContentWidth } from "@/components/layout/ContentWidth";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageSection } from "@/components/layout/PageSection";
import { TwoColumn } from "@/components/layout/TwoColumn";
import { PriorityDot } from "@/components/RowMark";
import { formatNumberFa, formatPhoneFa, toFaDigits } from "@/lib/format";
import { jalaliMonthName } from "@/modules/academic/primary-objectives";
import { REFERRAL_KIND_LABELS, REFERRAL_STATE_LABELS, REPORT_KIND_LABELS, initialsOf, referralState, type ReferralState } from "@/modules/counseling/policy";
import { studentFileQuery } from "@/modules/counseling/queries";
import { NoteCard, NoteComposer, ReferralActions } from "@/modules/counseling/ui";

export const metadata: Metadata = { title: "پروندهٴ مشاوره" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATE_TONE: Record<ReferralState, ChipTone> = { pending: "neutral", in_progress: "primary", done: "success", closed: "neutral" };

/**
 * «پروندهٴ مشاوره» of one student (owner 2026-10-13): مشخصات (an initials mark — no photo in phase 1 — the student
 * number, class, school and the guardian's phones as tap-to-call links) and «وضعیت تحصیلی» (this year's absences,
 * lates and تکالیف, a primary student's report card) beside the work: the counselor's notes (with «یادداشت جدید» for
 * a counselor of the school; management reads only the notes made visible to it), the teachers' reports and the
 * referrals with their live status and management's answer. «ارجاع به مدیریت» / «درخواست گزارش از دبیر» are the
 * counselor's secondary actions. Anything outside the viewer's reach is «چنین صفحه‌ای پیدا نشد», never a 403.
 */
export default async function StudentFilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const result = await studentFileQuery({ studentProfileId: id });
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const { student, academic, notes, reports, referrals, teachers, viewer } = result.data;
  const name = `${student.firstName} ${student.lastName}`;
  const { attendance, work, reportCard } = academic;

  return (
    <ContentWidth className="reveal-stagger">
      <PageHeader
        back={{ href: "/counseling", label: "مشاوره" }}
        title={<bdi>{name}</bdi>}
        description={
          <>
            {student.classGroupName ? (
              <>
                کلاس <bdi>{student.classGroupName}</bdi>
                {" · "}
              </>
            ) : null}
            <bdi>{student.schoolName}</bdi>
            {" · "}
            سال تحصیلی <bdi>{student.academicYearName}</bdi>
          </>
        }
        actions={viewer.canRefer ? <ReferralActions studentProfileId={student.studentProfileId} studentName={name} teachers={teachers} /> : null}
      />

      <TwoColumn
        asideFirst
        main={
          <>
            <PageSection id="notes" title="یادداشت‌های مشاور" icon={NotebookPen} count={notes.length} surface="work" flush>
              {viewer.canWrite ? (
                <div className="border-b border-line/70 p-4">
                  <NoteComposer studentProfileId={student.studentProfileId} />
                </div>
              ) : null}
              {notes.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-text-muted">
                  {viewer.canWrite ? "هنوز یادداشتی برای این دانش‌آموز ثبت نشده است." : "مشاور هنوز یادداشتی برای مدیریت مدرسه ثبت نکرده است."}
                </p>
              ) : (
                <ul className="divide-y divide-line/70">
                  {notes.map((n) => (
                    <NoteCard
                      key={n.id}
                      note={{
                        id: n.id,
                        kind: n.kind,
                        visibility: n.visibility,
                        body: n.body,
                        authorName: n.authorName,
                        createdAt: n.createdAt.toISOString(),
                        updatedAt: n.updatedAt.toISOString(),
                        mine: n.mine,
                        editable: n.editable,
                      }}
                    />
                  ))}
                </ul>
              )}
            </PageSection>

            <PageSection id="reports" title="گزارش دبیران" icon={ClipboardList} count={reports.length}>
              {reports.length === 0 ? (
                <p className="px-1 text-sm text-text-muted">دبیری هنوز گزارشی دربارهٴ این دانش‌آموز نفرستاده است.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line/70">
                  {reports.map((r) => (
                    <li key={r.id} className="flex flex-col gap-1.5 px-1 py-3">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Chip tone="primary">{REPORT_KIND_LABELS[r.kind]}</Chip>
                        <span className="text-meta text-text-muted">
                          <bdi>{r.authorName}</bdi>
                          {r.subjectName ? (
                            <>
                              {" · "}
                              <bdi>{r.subjectName}</bdi>
                            </>
                          ) : null}
                          {" · "}
                          <RelativeTime at={r.createdAt} mode="time" />
                        </span>
                      </div>
                      <p className="text-sm leading-7 whitespace-pre-wrap text-text">
                        <bdi>{r.body}</bdi>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </PageSection>

            <PageSection id="referrals" title="ارجاع‌ها و درخواست‌ها" icon={Send} count={referrals.length}>
              {referrals.length === 0 ? (
                <p className="px-1 text-sm text-text-muted">ارجاعی برای این دانش‌آموز فرستاده نشده است.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line/70">
                  {referrals.map((r) => {
                    const state = referralState(r.statusCategory);
                    return (
                      <li key={r.id} className="flex flex-col gap-1.5 px-1 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-2 text-row font-medium text-text">
                            <bdi className="min-w-0 truncate">{r.title}</bdi>
                            {r.priority === "urgent" || r.priority === "high" ? <PriorityDot priority={r.priority} /> : null}
                          </span>
                          <Chip tone={STATE_TONE[state]}>{REFERRAL_STATE_LABELS[state]}</Chip>
                        </div>
                        <p className="text-meta text-text-muted">
                          {REFERRAL_KIND_LABELS[r.kind]} · <bdi>{r.createdByName}</bdi> · <RelativeTime at={r.createdAt} mode="time" />
                        </p>
                        {r.kind === "management" && r.lastNote ? (
                          <div className="surface-panel flex flex-col gap-1 px-3 py-2">
                            <p className="text-meta text-text-muted">
                              پاسخ مدیریت
                              {r.lastNoteBy ? (
                                <>
                                  {" · "}
                                  <bdi>{r.lastNoteBy}</bdi>
                                </>
                              ) : null}
                              {r.lastNoteAt ? (
                                <>
                                  {" · "}
                                  <RelativeTime at={r.lastNoteAt} mode="time" />
                                </>
                              ) : null}
                            </p>
                            <p className="text-sm leading-7 whitespace-pre-wrap text-text">
                              <bdi>{r.lastNote}</bdi>
                            </p>
                          </div>
                        ) : null}
                        {r.kind === "teacher" && r.assignees.length > 0 ? (
                          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-text-muted">
                            {r.assignees.map((a) => (
                              <li key={a.personId} className="flex items-center gap-1.5">
                                <bdi>{a.name}</bdi>
                                <Chip tone={a.state === "done" ? "success" : "neutral"}>{a.state === "done" ? "پاسخ داد" : "در انتظار"}</Chip>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </PageSection>
          </>
        }
        aside={
          <>
            <PageSection id="profile" title="مشخصات" surface="panel">
              <div className="flex items-center gap-3">
                {/* No photo in phase 1: the initials on a neutral circle. */}
                <span className="grid size-14 shrink-0 place-items-center rounded-full bg-surface text-section font-bold text-text-muted ring-1 ring-line" aria-hidden>
                  {initialsOf(student.firstName, student.lastName)}
                </span>
                <span className="flex min-w-0 flex-col">
                  <bdi className="truncate text-row font-semibold text-text">{name}</bdi>
                  <span className="text-meta text-text-muted">
                    شمارهٴ دانش‌آموزی{" "}
                    <bdi dir="ltr" className="tabular">
                      {toFaDigits(student.studentNumber)}
                    </bdi>
                  </span>
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                <dt className="text-text-muted">کلاس</dt>
                <dd className="text-text">{student.classGroupName ? <bdi>{student.classGroupName}</bdi> : "بدون کلاس"}</dd>
                <dt className="text-text-muted">پایه</dt>
                <dd className="text-text">{student.gradeName ?? "—"}</dd>
                <dt className="text-text-muted">مدرسه</dt>
                <dd className="text-text">
                  <bdi>{student.schoolName}</bdi>
                </dd>
                <dt className="self-center text-text-muted">ولی</dt>
                <dd className="flex flex-col">
                  {student.guardianPhones.length === 0 ? (
                    <span className="text-text-muted">شماره‌ای ثبت نشده</span>
                  ) : (
                    student.guardianPhones.map((p) => (
                      <a key={p} href={`tel:${p}`} className="inline-flex min-h-11 items-center gap-2 text-primary-700 hover:underline">
                        <Phone className="size-4 shrink-0" aria-hidden />
                        <bdi dir="ltr" className="tabular">
                          {formatPhoneFa(p)}
                        </bdi>
                      </a>
                    ))
                  )}
                </dd>
              </dl>
            </PageSection>

            <PageSection id="academic" title="وضعیت تحصیلی" surface="panel">
              <p className="text-meta text-text-muted">از آغاز سال تحصیلی تا امروز</p>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
                {(
                  [
                    ["غیبت", attendance.absent],
                    ["تأخیر", attendance.late],
                    ["موجه", attendance.excused],
                  ] as const
                ).map(([label, n]) => (
                  <div key={label} className="flex flex-col gap-0.5 rounded-xl bg-surface px-2 py-2 ring-1 ring-line">
                    <dt className="text-meta text-text-muted">{label}</dt>
                    <dd className="tabular text-section font-semibold text-text">{formatNumberFa(n)}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-sm text-text">
                تکالیف: <span className="tabular">{formatNumberFa(work.done)}</span> از <span className="tabular">{formatNumberFa(work.given)}</span> انجام‌شده
              </p>
              <p className={cn("mt-1 flex items-center gap-1.5 text-sm", work.overdue > 0 ? "text-text" : "text-text-muted")}>
                {work.overdue > 0 ? <span className="size-2 rounded-full bg-danger" aria-hidden /> : null}
                عقب‌افتاده: <span className="tabular">{formatNumberFa(work.overdue)}</span>
              </p>
              {reportCard ? (
                <Link prefetch={false} href={reportCard.href} className="surface-link pressable mt-3 flex min-h-11 items-center justify-between gap-2 rounded-xl bg-surface px-3 text-sm font-medium text-text ring-1 ring-line">
                  <span>کارنامهٴ توصیفی · ماه {jalaliMonthName(reportCard.month)}</span>
                  <ChevronLeft className="size-4 shrink-0 text-text-faint" aria-hidden />
                </Link>
              ) : null}
            </PageSection>
          </>
        }
      />
    </ContentWidth>
  );
}
