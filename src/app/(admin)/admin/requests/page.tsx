import { CalendarOff, ChevronLeft, ClipboardList, Lock, MessageSquareText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Chip, type ChipTone } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { RelativeTime } from "@/components/RelativeTime";
import { RowMark } from "@/components/RowMark";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageSection } from "@/components/layout/PageSection";
import { Button } from "@/components/ui/button";
import { SelectNative } from "@/components/ui/select-native";
import { formatNumberFa } from "@/lib/format";
import { requestCenterQuery } from "@/modules/workspace/queries";
import { REQUEST_KINDS, REQUEST_KIND_CODES, type RequestKind, SLA_STATUS_FA, type SlaStatus } from "@/modules/workspace/request-sla";
import type { RequestCenterRow } from "@/modules/workspace/requests";

export const metadata: Metadata = { title: "مرکز درخواست‌ها | مدیریت" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));
const STATUSES: readonly SlaStatus[] = ["overdue", "near", "on_time"];
const STATUS_TONE: Record<SlaStatus, ChipTone> = { on_time: "neutral", near: "warning", overdue: "danger" };
const KIND_ICON: Record<RequestKind, typeof ClipboardList> = { admin_request: ClipboardList, parent_message: MessageSquareText, leave_request: CalendarOff };

/**
 * «مرکز درخواست‌ها» (owner 2026-10-20; docs/decisions.md «یادآوری مهلت و مرکز درخواست‌ها»): every OPEN request of the
 * manager's schools — a counselor's referral, a guardian's message — with its kind, school, age, response-time status
 * (در مهلت / نزدیک مهلت / گذشته), automatic escalations and current addressees; overdue first by deadline. A
 * confidential request shows its title and opens only for its participants (`requestCenterView`); everyone else reads
 * «درخواست محرمانه». Filters are a GET form (the URL is the state). Off until the organization turns the center on.
 */
export default async function RequestCenterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const kindParam = one(sp.kind);
  const statusParam = one(sp.status);
  const schoolParam = one(sp.school);
  if (schoolParam && !UUID_RE.test(schoolParam)) notFound();
  const kind = (REQUEST_KIND_CODES as readonly string[]).includes(kindParam) ? (kindParam as RequestKind) : null;
  const status = (STATUSES as readonly string[]).includes(statusParam) ? (statusParam as SlaStatus) : null;
  const result = await requestCenterQuery({ kind, status, schoolId: schoolParam || null });
  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED") redirect("/login");
    notFound();
  }
  const view = result.data;

  if (!view.enabled) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="مرکز درخواست‌ها" />
        <EmptyState
          title="مرکز درخواست‌ها روشن نیست"
          description="مدیر سازمان می‌تواند آن را در «تنظیمات» › «قابلیت‌ها» روشن کند؛ از آن پس مهلت پاسخ هر درخواست پیگیری می‌شود."
          className="surface-work"
        />
      </div>
    );
  }

  const filtered = Boolean(kind || status || schoolParam);
  const overdue = view.rows.filter((r) => r.status === "overdue").length;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="مرکز درخواست‌ها"
        count={formatNumberFa(view.rows.length)}
        description={overdue > 0 ? `${formatNumberFa(overdue)} درخواست از مهلت پاسخ گذشته است.` : "درخواست‌های باز مدرسه و مهلت پاسخ هر کدام."}
      />

      <form method="get" className="surface-panel flex flex-wrap items-end gap-2 p-3" aria-label="فیلترها">
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-meta text-text-muted">
          نوع
          <SelectNative name="kind" defaultValue={kind ?? ""} className="h-11">
            <option value="">همه</option>
            {REQUEST_KIND_CODES.filter((k) => REQUEST_KINDS[k].workItemType !== null).map((k) => (
              <option key={k} value={k}>
                {REQUEST_KINDS[k].labelFa}
              </option>
            ))}
          </SelectNative>
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-meta text-text-muted">
          وضعیت مهلت
          <SelectNative name="status" defaultValue={status ?? ""} className="h-11">
            <option value="">همه</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {SLA_STATUS_FA[s]}
              </option>
            ))}
          </SelectNative>
        </label>
        {view.schools.length > 1 ? (
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-meta text-text-muted">
            مدرسه
            <SelectNative name="school" defaultValue={schoolParam} className="h-11">
              <option value="">همهٴ مدرسه‌ها</option>
              {view.schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </SelectNative>
          </label>
        ) : null}
        <Button type="submit" variant="outline" className="h-11">
          نمایش
        </Button>
        {filtered ? (
          <Button asChild variant="ghost" className="h-11">
            <Link href="/admin/requests">حذف فیلتر</Link>
          </Button>
        ) : null}
      </form>

      {view.rows.length === 0 ? (
        <EmptyState
          title={filtered ? "با این فیلتر درخواستی پیدا نشد" : "درخواست بازی در انتظار پاسخ نیست"}
          description={filtered ? undefined : "ارجاع‌های مشاور و پیام‌های اولیا تا پاسخ بگیرند این‌جا می‌مانند."}
          className="surface-work"
        />
      ) : (
        <PageSection id="open-requests" title="درخواست‌های باز" surface="work" flush>
          <ul className="divide-y divide-line/70">
            {view.rows.map((r) => (
              <li key={r.id}>
                {r.href ? (
                  <Link href={r.href} className="pressable flex items-start gap-3 px-3.5 py-3 first:rounded-t-card last:rounded-b-card hover:bg-surface-sunken">
                    <RowBody row={r} />
                    <ChevronLeft className="mt-2 size-4 shrink-0 text-text-faint" aria-hidden />
                  </Link>
                ) : (
                  <div className="flex items-start gap-3 px-3.5 py-3">
                    <RowBody row={r} />
                  </div>
                )}
              </li>
            ))}
          </ul>
          {view.truncated ? <p className="px-4 py-3 text-center text-meta text-text-muted">فقط ۳۰۰ درخواستِ نزدیک‌ترین به مهلت نمایش داده شده است.</p> : null}
        </PageSection>
      )}
    </div>
  );
}

function RowBody({ row }: { row: RequestCenterRow }) {
  return (
    <>
      <RowMark icon={row.titleHidden ? Lock : KIND_ICON[row.kind]} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-row font-medium text-text">
            <bdi>{row.title}</bdi>
          </span>
          <Chip tone={STATUS_TONE[row.status]}>{SLA_STATUS_FA[row.status]}</Chip>
          {row.escalations > 0 ? <Chip>ارجاع خودکار{row.escalations > 1 ? ` ×${formatNumberFa(row.escalations)}` : ""}</Chip> : null}
        </span>
        <span className="text-meta text-text-muted">
          {row.kindLabel}
          <span aria-hidden> · </span>
          <bdi>{row.schoolName}</bdi>
          <span aria-hidden> · </span>
          ارسال <RelativeTime at={row.openedAt} mode="time" />
          <span aria-hidden> · </span>
          مهلت پاسخ <RelativeTime at={row.dueAt} mode="due" />
        </span>
        <span className="text-meta text-text-muted">
          {row.addressees.length > 0 ? (
            <>
              گیرندگان: <bdi>{row.addressees.join("، ")}</bdi>
            </>
          ) : (
            "گیرنده‌ای نمانده است"
          )}
        </span>
      </div>
    </>
  );
}
