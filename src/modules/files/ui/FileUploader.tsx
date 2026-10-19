"use client";

// «افزودن فایل» — the picker of the create / edit forms and of «پاسخ شما». Each picked file is checked in the browser
// against the same bounds the server enforces (src/modules/files/limits), then uploaded ON ITS OWN, one at a time, to
// POST /api/files as the raw body (XMLHttpRequest — the only browser API with upload progress), its name
// percent-encoded in `X-File-Name`. Every row says its own state: progress, an error in Persian (with «تلاش دوباره»
// for a failed send), or done. The parent receives the ids of the finished uploads and whether one is still running
// (its submit waits); the form's own Server Action then attaches exactly those ids — an upload never left in a form
// expires on the server after a day. A row's × aborts a running upload or drops the file from the form.
import { Paperclip, RotateCw, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { RowMark } from "@/components/RowMark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatNumberFa } from "@/lib/format";
import { ACCEPT_ATTRIBUTE, type FileKind } from "../kinds";
import { FILE_LIMITS, FILE_MESSAGES, MiB, fileSizeProblem, formatBytesFa, type UploadPurpose } from "../limits";
import { fileIcon, fileMeta } from "./FileRows";

export interface UploaderState {
  /** Ids of the finished uploads, in the order picked. */
  fileIds: string[];
  /** An upload is queued or running — the form's submit waits. */
  busy: boolean;
  /** Bytes of the finished uploads (the پاسخ's 25 MiB total). */
  bytes: number;
}

interface Entry {
  key: string;
  name: string;
  size: number;
  status: "queued" | "uploading" | "done" | "error";
  progress: number;
  error?: string;
  /** Kept for «تلاش دوباره» (a failed send); absent for a file the browser already refused. */
  file?: File;
  fileId?: string;
  kind?: FileKind;
}

type UploadReply = { ok: true; data: { id: string; name: string; sizeBytes: number; kind: FileKind } } | { ok: false; message: string };

function send(url: string, file: File, onProgress: (fraction: number) => void): { done: Promise<UploadReply>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const done = new Promise<UploadReply>((resolve) => {
    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      const body = xhr.response as UploadReply | null;
      if (xhr.status === 201 && body && body.ok) resolve(body);
      else resolve({ ok: false, message: body && !body.ok && body.message ? body.message : FILE_MESSAGES.incomplete });
    };
    xhr.onerror = () => resolve({ ok: false, message: FILE_MESSAGES.incomplete });
    xhr.ontimeout = () => resolve({ ok: false, message: FILE_MESSAGES.timeout });
    xhr.onabort = () => resolve({ ok: false, message: "" });
    xhr.send(file);
  });
  return { done, abort: () => xhr.abort() };
}

export interface FileUploaderProps {
  purpose: UploadPurpose;
  /** The تکلیف the files are for; omitted for a تکلیف being created. */
  workItemId?: string;
  /** Files this form may still add (the set's limit minus what it keeps). */
  maxFiles: number;
  /** A پاسخ's total cap and what it already keeps; omitted for a تکلیف (no total). */
  maxTotalBytes?: number;
  keptBytes?: number;
  disabled?: boolean;
  onChange: (state: UploaderState) => void;
}

export function FileUploader({ purpose, workItemId, maxFiles, maxTotalBytes, keptBytes = 0, disabled = false, onChange }: FileUploaderProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const aborts = useRef(new Map<string, () => void>());
  const notify = useRef(onChange);
  useEffect(() => {
    notify.current = onChange;
  });

  const url = `/api/files?purpose=${purpose}${workItemId ? `&workItemId=${encodeURIComponent(workItemId)}` : ""}`;

  // Tell the form what is ready and whether anything still runs.
  useEffect(() => {
    const done = entries.filter((e) => e.status === "done" && e.fileId);
    notify.current({
      fileIds: done.map((e) => e.fileId!),
      busy: entries.some((e) => e.status === "queued" || e.status === "uploading"),
      bytes: done.reduce((a, e) => a + e.size, 0),
    });
  }, [entries]);

  // One upload at a time: when nothing runs, start the first queued file.
  useEffect(() => {
    if (entries.some((e) => e.status === "uploading")) return;
    const next = entries.find((e) => e.status === "queued");
    if (!next?.file) return;
    const key = next.key;
    const update = (patch: Partial<Entry>) => setEntries((all) => all.map((e) => (e.key === key ? { ...e, ...patch } : e)));
    update({ status: "uploading", progress: 0, error: undefined });
    let shown = 0;
    const { done, abort } = send(url, next.file, (fraction) => {
      const pct = Math.floor(fraction * 100);
      if (pct !== shown) {
        shown = pct;
        update({ progress: pct });
      }
    });
    aborts.current.set(key, abort);
    void done.then((reply) => {
      aborts.current.delete(key);
      if (reply.ok) update({ status: "done", progress: 100, fileId: reply.data.id, name: reply.data.name, kind: reply.data.kind, size: reply.data.sizeBytes });
      else if (reply.message === "") setEntries((all) => all.filter((e) => e.key !== key)); // aborted by its ×
      else update({ status: "error", error: reply.message });
    });
  }, [entries, url]);

  // A form that closes mid-upload stops sending.
  useEffect(() => {
    const running = aborts.current;
    return () => {
      for (const abort of running.values()) abort();
    };
  }, []);

  const live = entries.filter((e) => e.status !== "error");
  const remaining = Math.max(0, maxFiles - live.length);

  const pick = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    let room = remaining;
    let total = keptBytes + live.reduce((a, e) => a + e.size, 0);
    const added: Entry[] = [];
    for (const file of Array.from(list)) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const base = { key, name: file.name, size: file.size, progress: 0 };
      const sizeProblem = fileSizeProblem(file.size);
      if (room <= 0) added.push({ ...base, status: "error", error: purpose === "submission" ? FILE_MESSAGES.tooManySubmissionFiles : FILE_MESSAGES.tooManyItemFiles });
      else if (sizeProblem) added.push({ ...base, status: "error", error: sizeProblem });
      else if (maxTotalBytes !== undefined && total + file.size > maxTotalBytes) added.push({ ...base, status: "error", error: FILE_MESSAGES.submissionTooLarge });
      else {
        added.push({ ...base, status: "queued", file });
        room--;
        total += file.size;
      }
    }
    setEntries((all) => [...all, ...added]);
  };

  const remove = (key: string) => {
    const abort = aborts.current.get(key);
    if (abort) abort();
    else setEntries((all) => all.filter((e) => e.key !== key));
  };

  const retry = (key: string) => setEntries((all) => all.map((e) => (e.key === key ? { ...e, status: "queued", progress: 0, error: undefined } : e)));

  return (
    <div className="flex flex-col gap-2">
      {entries.length > 0 ? (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {entries.map((e) => (
            <li key={e.key} className="flex min-h-12 items-center gap-3 px-3 py-2 text-sm">
              <RowMark icon={e.kind ? fileIcon(e.kind) : Paperclip} tone={e.status === "error" ? "danger" : "muted"} />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <bdi className="truncate text-row text-text">{e.name}</bdi>
                {e.status === "error" ? (
                  <span role="alert" className="text-meta text-danger">
                    {e.error}
                  </span>
                ) : e.status === "done" && e.kind ? (
                  <span className="text-meta text-text-muted">{fileMeta({ kind: e.kind, sizeBytes: e.size })}</span>
                ) : (
                  <span className="flex items-center gap-2 text-meta text-text-muted">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={e.progress} aria-label={`بارگذاری ${e.name}`}>
                      <span className="block h-full rounded-full bg-sky transition-[width]" style={{ width: `${e.progress}%` }} />
                    </span>
                    <span className="tabular">{e.status === "queued" ? "در صف" : `${formatNumberFa(e.progress)}٪`}</span>
                  </span>
                )}
              </span>
              {e.status === "error" && e.file ? (
                <Button type="button" variant="ghost" size="icon" onClick={() => retry(e.key)} aria-label={`تلاش دوباره برای ${e.name}`}>
                  <RotateCw aria-hidden />
                </Button>
              ) : null}
              <Button type="button" variant="ghost" size="icon" onClick={() => remove(e.key)} aria-label={e.status === "uploading" ? `توقف بارگذاری ${e.name}` : `برداشتن ${e.name}`}>
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        tabIndex={-1}
        onChange={(ev) => {
          pick(ev.target.files);
          ev.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button type="button" variant="outline" disabled={disabled || remaining === 0} onClick={() => inputRef.current?.click()} className={cn("w-full sm:w-auto")}>
          <Paperclip aria-hidden />
          افزودن فایل
        </Button>
        <p className="text-meta text-text-muted">
          {`تا ${formatNumberFa(remaining)} فایل دیگر، هر کدام حداکثر ${formatNumberFa(FILE_LIMITS.maxFileBytes / MiB)} مگابایت`}
          {maxTotalBytes !== undefined ? ` (همه با هم ${formatBytesFa(maxTotalBytes)})` : ""}
          {" — پی‌دی‌اف، عکس، ورد، اکسل، پاورپوینت، متن یا صوت."}
        </p>
      </div>
    </div>
  );
}
