// «پاسخ‌های دانش‌آموزان» — every پاسخ of a تکلیف and who has not answered, for its managers only (the giver, a broad
// admin who is not assigned — workspace/submissions `readSubmissionsOverview`; 0024's RESTRICTIVE policy says the same).
// «۱۲ از ۲۴ تحویل داده‌اند» counts the CURRENT student assignees; a removed student's پاسخ is still listed (tagged
// «حذف‌شده») — history for the giver. Each row opens in place (<details>): the whole text and the files, each a
// download re-authorized on every request. No hooks — a server component.
import { ChevronDown } from "lucide-react";
import { Chip } from "@/components/Chip";
import { RelativeTime } from "@/components/RelativeTime";
import { cn } from "@/lib/cn";
import { formatNumberFa } from "@/lib/format";
import { FileRows } from "@/modules/files/ui/FileRows";
import type { SubmissionsOverview as Overview } from "../submissions";

const PREVIEW_CHARS = 90;

function preview(body: string | null, files: number): string {
  if (body) {
    const line = body.replace(/\s+/g, " ").trim();
    return line.length > PREVIEW_CHARS ? `${line.slice(0, PREVIEW_CHARS)}…` : line;
  }
  return files > 0 ? `${formatNumberFa(files)} فایل، بدون متن` : "";
}

export function SubmissionsOverview({ overview }: { overview: Overview }) {
  const { assigneeCount, submittedCount, submissions, missing } = overview;
  const complete = assigneeCount > 0 && submittedCount === assigneeCount;
  return (
    <section aria-labelledby="submissions-heading" className="surface-work">
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
        <h3 id="submissions-heading" className="text-section font-semibold text-text">
          پاسخ‌های دانش‌آموزان
        </h3>
        <span className="tabular text-sm font-medium text-text">
          {formatNumberFa(submittedCount)} از {formatNumberFa(assigneeCount)} تحویل داده‌اند
        </span>
      </div>
      <div className="mx-4 h-1.5 overflow-hidden rounded-full bg-neutral-200" role="progressbar" aria-valuemin={0} aria-valuemax={assigneeCount} aria-valuenow={submittedCount} aria-label="پاسخ‌های تحویل‌شده">
        <div className={cn("h-full rounded-full", complete ? "bg-success" : "bg-sky")} style={{ width: `${assigneeCount ? Math.round((submittedCount / assigneeCount) * 100) : 0}%` }} />
      </div>
      {submissions.length === 0 ? (
        <p className="px-4 py-3 text-sm text-text-muted">هنوز پاسخی برای این تکلیف ثبت نشده است.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {submissions.map((s) => {
            const edited = s.updatedAt.getTime() - s.submittedAt.getTime() > 60_000;
            return (
              <li key={s.id}>
                <details className="group">
                  <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2 hover:bg-surface-sunken [&::-webkit-details-marker]:hidden">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex min-w-0 items-center gap-2">
                        <bdi className="truncate text-row text-text">{s.studentName}</bdi>
                        {s.studentRemoved ? <Chip>حذف‌شده</Chip> : null}
                      </span>
                      <span className="truncate text-meta text-text-muted">
                        <bdi>{preview(s.body, s.files.length)}</bdi>
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end text-meta text-text-muted">
                      <RelativeTime at={s.updatedAt} mode="time" />
                      {s.files.length > 0 ? <span className="tabular">{formatNumberFa(s.files.length)} فایل</span> : null}
                    </span>
                    <ChevronDown className="size-4 shrink-0 text-text-faint transition-transform group-open:rotate-180" aria-hidden />
                  </summary>
                  <div className="flex flex-col gap-2 border-t border-line/70 px-4 pt-3 pb-1">
                    <p className="text-meta text-text-muted">
                      ثبت: <RelativeTime at={s.submittedAt} mode="time" />
                      {edited ? (
                        <>
                          {" · "}ویرایش: <RelativeTime at={s.updatedAt} mode="time" />
                        </>
                      ) : null}
                    </p>
                    {s.body ? (
                      <p className="text-sm leading-7 whitespace-pre-wrap text-text">
                        <bdi>{s.body}</bdi>
                      </p>
                    ) : null}
                    <FileRows files={s.files} className="-mx-4" label={`فایل‌های پاسخ ${s.studentName}`} />
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
      {missing.length > 0 ? (
        <div className="border-t border-line px-4 py-3">
          <p className="text-meta text-text-muted">هنوز تحویل نداده‌اند ({formatNumberFa(missing.length)} نفر)</p>
          <p className="mt-1 text-sm leading-7 text-text">
            {missing.map((m, i) => (
              <span key={m.personId}>
                {i > 0 ? "، " : ""}
                <bdi>{m.name}</bdi>
              </span>
            ))}
          </p>
        </div>
      ) : null}
    </section>
  );
}
