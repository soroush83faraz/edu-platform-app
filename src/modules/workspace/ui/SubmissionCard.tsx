"use client";

// «پاسخ شما» — a student's own پاسخ to a تکلیف given to them (owner 2026-10-19, «تحویل پاسخ»; workspace/submissions).
// Saved: the text, the files, when it was sent and last edited, and «ویرایش پاسخ» while the تکلیف is open. Not yet
// sent: the form straight away — text (optional) + «افزودن فایل» + «ثبت پاسخ», which needs one of the two. Editing
// keeps the files not taken out (× marks one, ↺ brings it back) and adds new uploads; the server re-checks every
// rule (open تکلیف, ≤ 5 files, ≤ 25 MiB, never empty). Closed by the giver: read-only, with the reason. After a
// first «ثبت پاسخ» the card reminds an unfinished student of «انجام شد» (a پاسخ does not tick it by itself).
import { Pencil, Send, Undo2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { RelativeTime } from "@/components/RelativeTime";
import { RowMark } from "@/components/RowMark";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { flatten } from "@/lib/form-errors";
import { FILE_LIMITS, FILE_MESSAGES } from "@/modules/files/limits";
import { FileRows, type FileRowData, fileIcon, fileMeta } from "@/modules/files/ui/FileRows";
import { FileUploader, type UploaderState } from "@/modules/files/ui/FileUploader";
import { saveSubmissionAction } from "../actions";

export interface SubmissionCardData {
  body: string | null;
  submittedAt: Date;
  updatedAt: Date;
  files: FileRowData[];
}

export interface SubmissionCardProps {
  workItemId: string;
  submission: SubmissionCardData | null;
  /** The تکلیف is open (not closed by its giver, not removed). */
  canSubmit: boolean;
  /** «ورود آزمایشی»: no uploads (the text still goes). */
  uploadsBlocked: boolean;
  /** The student's own «انجام شد» is already ticked. */
  myDone: boolean;
}

const NO_UPLOADS: UploaderState = { fileIds: [], busy: false, bytes: 0 };
/** An edit later than this after the first send reads «ویرایش: …». */
const EDIT_SHOWN_AFTER_MS = 60_000;

export function SubmissionCard({ workItemId, submission, canSubmit, uploadsBlocked, myDone }: SubmissionCardProps) {
  const router = useRouter();
  const headingId = useId();
  const [editing, setEditing] = useState(submission === null && canSubmit);
  const [justSent, setJustSent] = useState(false);

  if (editing) {
    return (
      <section aria-labelledby={headingId} className="surface-work flex flex-col gap-4 p-4">
        <h3 id={headingId} className="text-section font-semibold text-text">
          پاسخ شما
        </h3>
        <SubmissionForm
          workItemId={workItemId}
          submission={submission}
          uploadsBlocked={uploadsBlocked}
          onCancel={submission ? () => setEditing(false) : undefined}
          onSaved={(first) => {
            setEditing(false);
            setJustSent(first);
            router.refresh();
          }}
        />
      </section>
    );
  }

  const edited = submission ? submission.updatedAt.getTime() - submission.submittedAt.getTime() > EDIT_SHOWN_AFTER_MS : false;
  return (
    <section aria-labelledby={headingId} className="surface-work flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={headingId} className="text-section font-semibold text-text">
          پاسخ شما
        </h3>
        {submission && canSubmit ? (
          <Button variant="outline" className="w-full sm:w-auto" onClick={() => setEditing(true)}>
            <Pencil aria-hidden />
            ویرایش پاسخ
          </Button>
        ) : null}
      </div>
      {submission ? (
        <>
          <p className="text-meta text-text-muted">
            ثبت: <RelativeTime at={submission.submittedAt} mode="time" />
            {edited ? (
              <>
                {" · "}ویرایش: <RelativeTime at={submission.updatedAt} mode="time" />
              </>
            ) : null}
          </p>
          {submission.body ? (
            <p className="text-sm leading-7 whitespace-pre-wrap text-text">
              <bdi>{submission.body}</bdi>
            </p>
          ) : null}
          {submission.files.length > 0 ? <FileRows files={submission.files} className="-mx-4 border-t border-line" label="فایل‌های پاسخ شما" /> : null}
          {!canSubmit ? (
            <p className="text-meta text-text-muted">این تکلیف بسته شده است؛ پاسخ دیگر ویرایش نمی‌شود.</p>
          ) : justSent && !myDone ? (
            <p role="status" className="text-meta text-text-muted">
              پاسخ شما ثبت شد. اگر کارتان تمام است، «انجام شد» را هم بزنید.
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-text-muted">{canSubmit ? "هنوز پاسخی ثبت نکرده‌اید." : "این تکلیف بسته شده است؛ پاسخی برای آن ثبت نکردید."}</p>
      )}
    </section>
  );
}

function SubmissionForm({
  workItemId,
  submission,
  uploadsBlocked,
  onCancel,
  onSaved,
}: {
  workItemId: string;
  submission: SubmissionCardData | null;
  uploadsBlocked: boolean;
  onCancel?: () => void;
  onSaved: (first: boolean) => void;
}) {
  const ids = useId();
  const [pending, start] = useTransition();
  const [body, setBody] = useState(submission?.body ?? "");
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const [uploads, setUploads] = useState<UploaderState>(NO_UPLOADS);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const existing = submission?.files ?? [];
  const kept = existing.filter((f) => !removed.has(f.id));
  const keptBytes = kept.reduce((a, f) => a + f.sizeBytes, 0);
  const empty = body.trim() === "" && kept.length + uploads.fileIds.length === 0;
  const changed = !submission || body.trim() !== (submission.body ?? "") || removed.size > 0 || uploads.fileIds.length > 0;
  const blocked = pending || uploads.busy || empty || !changed;

  const toggle = (id: string) =>
    setRemoved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (empty) {
      setErrors({ body: FILE_MESSAGES.emptySubmission });
      return;
    }
    if (blocked) return;
    start(async () => {
      const r = await saveSubmissionAction({
        workItemId,
        body: body.trim(),
        addFiles: uploads.fileIds,
        removeFiles: [...removed],
      });
      if (r.ok) {
        toast.success(r.data.first ? "پاسخ شما ثبت شد" : "پاسخ شما ویرایش شد");
        onSaved(r.data.first);
        return;
      }
      setErrors(flatten(r.fieldErrors, r.message, ["body", "files"]));
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${ids}-body`}>
          متن پاسخ <span className="text-text-faint">(اختیاری اگر فایل می‌فرستید)</span>
        </Label>
        <Textarea
          id={`${ids}-body`}
          dir="auto"
          rows={4}
          maxLength={FILE_LIMITS.maxSubmissionBodyChars}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-invalid={errors.body ? true : undefined}
          aria-describedby={errors.body ? `${ids}-body-err` : undefined}
        />
        <FieldError id={`${ids}-body-err`} text={errors.body} />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-text">فایل‌ها</span>
        {existing.length > 0 ? (
          <ul className="divide-y divide-line rounded-lg border border-line" aria-label="فایل‌های پاسخ شما">
            {existing.map((f) => {
              const gone = removed.has(f.id);
              return (
                <li key={f.id} className="flex min-h-12 items-center gap-3 px-3 py-2 text-sm">
                  <RowMark icon={fileIcon(f.kind)} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <bdi className={cn("truncate text-row", gone ? "text-text-faint line-through" : "text-text")}>{f.name}</bdi>
                    <span className="text-meta text-text-muted">{gone ? "با ثبت برداشته می‌شود" : fileMeta(f)}</span>
                  </span>
                  <Button type="button" variant="ghost" size="icon" onClick={() => toggle(f.id)} aria-label={gone ? `بازگرداندن ${f.name}` : `برداشتن ${f.name}`}>
                    {gone ? <Undo2 aria-hidden /> : <X aria-hidden />}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {uploadsBlocked ? (
          <p className="text-meta text-text-muted">در ورود آزمایشی بارگذاری فایل ممکن نیست؛ پاسخ را بنویسید.</p>
        ) : (
          <FileUploader
            purpose="submission"
            workItemId={workItemId}
            maxFiles={FILE_LIMITS.maxSubmissionFiles - kept.length}
            maxTotalBytes={FILE_LIMITS.maxSubmissionBytes}
            keptBytes={keptBytes}
            onChange={setUploads}
          />
        )}
        <FieldError id={`${ids}-files-err`} text={errors.files} />
      </div>

      <p role="alert" className={cn("text-sm text-danger", !errors.form && "hidden")}>
        {errors.form}
      </p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            انصراف
          </Button>
        ) : null}
        <Button type="submit" className="min-w-32" disabled={blocked}>
          <Send aria-hidden className="rtl:-scale-x-100" />
          {pending ? "در حال ثبت…" : "ثبت پاسخ"}
        </Button>
      </div>
    </form>
  );
}

function FieldError({ id, text }: { id: string; text?: string }) {
  return (
    <p id={id} role="alert" className={cn("text-sm text-danger", !text && "hidden")}>
      {text}
    </p>
  );
}
