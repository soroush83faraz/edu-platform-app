// files/limits — every number of «پیوست تکلیف و تحویل پاسخ» in ONE place (owner 2026-10-19; docs/decisions.md), and
// the pure rules over them (unit-tested: tests/unit/files-limits.test.ts). Pure: the picker imports the per-file and
// per-set bounds to refuse early in the browser; the server re-checks every one of them.
import { formatNumberFa } from "@/lib/format";

export const MiB = 1024 * 1024;

/**
 * Who uploads: a giver's «فایل‌های تکلیف» (`work_item`) or a student's «پاسخ» (`submission`). The purpose also picks the
 * daily quota — only staff hold `workspace.work_item.attach`, only students `workspace.work_item.submit`.
 */
export const UPLOAD_PURPOSES = ["work_item", "submission"] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export const FILE_LIMITS = {
  /** One file, after upload. 10 MiB keeps one upload request (one file, raw body) under Caddy's 12 MB request cap. */
  maxFileBytes: 10 * MiB,
  /** Files of one تکلیف (the giver's set). */
  maxItemFiles: 5,
  /** Files of one student's پاسخ, and their total. */
  maxSubmissionFiles: 5,
  maxSubmissionBytes: 25 * MiB,
  /** The پاسخ text (the comment table's bound). */
  maxSubmissionBodyChars: 4000,
  /** A display name, in code points, extension included (the DB CHECK allows 200). */
  maxNameChars: 120,
  /** Rolling 24 h per person, every upload counted (attached, pending or removed since). */
  daily: {
    submission: { bytes: 50 * MiB, files: 100 },
    work_item: { bytes: 200 * MiB, files: 300 },
  } satisfies Record<UploadPurpose, { bytes: number; files: number }>,
  /** An upload never attached to a form is archived (bytes deleted) after this long. */
  pendingTtlMs: 24 * 60 * 60 * 1000,
  /** A temp file left by a crash mid-upload is deleted after this long. */
  tempTtlMs: 60 * 60 * 1000,
  /** Uploads are refused below this much free space on the files volume (the database shares the disk). */
  minFreeDiskBytes: 1024 * MiB,
  /**
   * The pace of an upload's body (security review 2026-10-19, D2): a slot is held only by a body that keeps coming.
   * Aborted (`./receive`) when no byte arrives for `idleTimeoutMs`; when, once `slowGraceMs` have passed, the AVERAGE
   * rate since the receiver started is below `minBytesPerSecond`; and in any case after `totalTimeoutMs` — a hard wall
   * clock (a full 10 MiB file therefore needs ~114 KiB/s). It sits UNDER the layers that would otherwise cut first,
   * without a word: Caddy's `read_body` (deploy/Caddyfile, 120 s for a whole request) and Node's own
   * `server.requestTimeout` (300 s — the http.Server default `next start` keeps), so this rule answers, in Persian.
   */
  idleTimeoutMs: 15 * 1000,
  totalTimeoutMs: 90 * 1000,
  minBytesPerSecond: 100 * 1024,
  slowGraceMs: 10 * 1000,
  /**
   * Uploads in flight per app process (each holds a file descriptor and a disk stream). The last
   * `reservedUploadSlots` are only for a person with no slow abort in the strike window, so a few accounts trickling
   * bytes cannot hold every slot (`slotCeilingFor`).
   */
  maxConcurrentUploads: 8,
  reservedUploadSlots: 2,
  /** One upload in flight per person (the picker sends one file at a time anyway). */
  maxConcurrentUploadsPerPerson: 1,
  /** Slow aborts (idle, under the rate, past the wall clock) per person in the window before uploads are refused (429). */
  maxSlowStrikes: 3,
  slowStrikeWindowMs: 10 * 60 * 1000,
  /** Upload attempts per person per hour, refused ones included (garbage that never reaches the quota). */
  maxAttemptsPerHour: 60,
} as const;

/**
 * The fairness rule of the process slots (D2), from the person's slow aborts in the strike window: null = refused (at
 * `maxSlowStrikes`); otherwise how many slots may be in flight for them to take one — all of them for a person with no
 * strike, all but the reserved ones for anyone with one.
 */
export function slotCeilingFor(slowStrikes: number): number | null {
  if (slowStrikes >= FILE_LIMITS.maxSlowStrikes) return null;
  return slowStrikes > 0 ? FILE_LIMITS.maxConcurrentUploads - FILE_LIMITS.reservedUploadSlots : FILE_LIMITS.maxConcurrentUploads;
}

/** Persian messages of the file rules (the server's AppErrors and the picker's own pre-checks say the same). */
export const FILE_MESSAGES = {
  tooLarge: `حجم هر فایل حداکثر ${formatNumberFa(FILE_LIMITS.maxFileBytes / MiB)} مگابایت است.`,
  empty: "این فایل خالی است.",
  badType: "این نوع فایل پذیرفته نیست. پی‌دی‌اف، عکس، سند ورد، اکسل، پاورپوینت، متن یا فایل صوتی بفرستید.",
  badName: "نام فایل معتبر نیست.",
  macro: "سندِ دارای ماکرو پذیرفته نیست؛ آن را بدون ماکرو ذخیره کنید.",
  activeContent: "سندِ دارای شیء جاسازی‌شده یا پیوند بیرونی پذیرفته نیست؛ آن را بدون آن‌ها ذخیره کنید یا به پی‌دی‌اف تبدیل کنید.",
  textEncoding: "این فایل متنی خوانا نیست؛ آن را با کدگذاری یونیکد ذخیره کنید.",
  tooManyItemFiles: `هر تکلیف حداکثر ${formatNumberFa(FILE_LIMITS.maxItemFiles)} فایل دارد.`,
  tooManySubmissionFiles: `هر پاسخ حداکثر ${formatNumberFa(FILE_LIMITS.maxSubmissionFiles)} فایل دارد.`,
  submissionTooLarge: `حجم همهٴ فایل‌های یک پاسخ حداکثر ${formatNumberFa(FILE_LIMITS.maxSubmissionBytes / MiB)} مگابایت است.`,
  quota: "سقف بارگذاری امروز شما پر شده است؛ فردا دوباره تلاش کنید.",
  busy: "سرور مشغول است؛ کمی بعد دوباره تلاش کنید.",
  diskFull: "فضای ذخیره‌سازی سرور پر است؛ به مدیر مدرسه اطلاع دهید.",
  expired: "یکی از فایل‌ها یافت نشد یا مهلتش گذشته است؛ آن را دوباره بارگذاری کنید.",
  incomplete: "بارگذاری کامل نشد؛ دوباره تلاش کنید.",
  timeout: "بارگذاری بیش از حد طول کشید؛ دوباره تلاش کنید.",
  tooSlow: "اتصال برای بارگذاری بیش از حد کند است؛ با اتصال بهتری دوباره تلاش کنید.",
  slowStrikes: "چند بارگذاری اخیر شما به‌خاطر کندی اتصال نیمه‌کاره ماند؛ چند دقیقهٔ دیگر با اتصال بهتری دوباره تلاش کنید.",
  emptySubmission: "متن پاسخ را بنویسید یا فایلی پیوست کنید.",
  submissionClosed: "این تکلیف بسته شده است؛ پاسخ دیگر ثبت یا ویرایش نمی‌شود.",
  attachNotHere: "به این مورد فایل پیوست نمی‌شود.",
} as const;

/** The quota of an upload of this purpose. */
export function dailyQuota(purpose: UploadPurpose): { bytes: number; files: number } {
  return FILE_LIMITS.daily[purpose];
}

/** Would one more file of `size` bytes stay inside today's quota, given what the person uploaded in the last 24 h? */
export function withinDailyQuota(purpose: UploadPurpose, used: { bytes: number; files: number }, size: number): boolean {
  const q = dailyQuota(purpose);
  return used.files + 1 <= q.files && used.bytes + size <= q.bytes;
}

/** The per-file bound: non-empty and at most `maxFileBytes`. */
export function fileSizeProblem(size: number): string | null {
  if (!Number.isFinite(size) || size <= 0) return FILE_MESSAGES.empty;
  if (size > FILE_LIMITS.maxFileBytes) return FILE_MESSAGES.tooLarge;
  return null;
}

/** A giver's set after the change: at most `maxItemFiles`. */
export function itemSetProblem(count: number): string | null {
  return count > FILE_LIMITS.maxItemFiles ? FILE_MESSAGES.tooManyItemFiles : null;
}

/** A پاسخ's set after the change: at most `maxSubmissionFiles` files and `maxSubmissionBytes` in all. */
export function submissionSetProblem(sizes: readonly number[]): string | null {
  if (sizes.length > FILE_LIMITS.maxSubmissionFiles) return FILE_MESSAGES.tooManySubmissionFiles;
  const total = sizes.reduce((a, b) => a + b, 0);
  return total > FILE_LIMITS.maxSubmissionBytes ? FILE_MESSAGES.submissionTooLarge : null;
}

/** «۲٫۴ مگابایت» / «۳۵۰ کیلوبایت» / «۸۰۰ بایت» — for rows and the picker. */
export function formatBytesFa(bytes: number): string {
  if (bytes >= MiB) {
    const v = bytes / MiB;
    return `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: v < 10 ? 1 : 0 }).format(v)} مگابایت`;
  }
  if (bytes >= 1024) return `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(Math.max(1, Math.round(bytes / 1024)))} کیلوبایت`;
  return `${formatNumberFa(bytes)} بایت`;
}
