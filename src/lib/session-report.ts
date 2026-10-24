// «دفتر کلاسی — گزارش جلسه»: the pure rules of the end-of-session report (migration 0027) — the length bounds the
// database CHECKs repeat, how a text is cleaned before it is stored, WHO sees which field, and the length-only
// snapshot the audit trail keeps. No React, no database: the service (src/modules/academic/session-report.ts) and the
// forms import from here, and tests/unit/session-report.test.ts pins every rule.
import { normalizeFa } from "@/lib/normalize";

/** Maximum characters per field — the same numbers as the `session_report_*_chk` CHECKs. */
export const SESSION_REPORT_LIMITS = { topic: 200, pageRef: 100, privateNote: 1000, nextPlan: 300 } as const;

export const SESSION_REPORT_MESSAGES = {
  topicRequired: "موضوع تدریس‌شده را بنویسید.",
  topicTooLong: "موضوع تدریس‌شده حداکثر ۲۰۰ نویسه است.",
  pageRefTooLong: "صفحه یا فصل حداکثر ۱۰۰ نویسه است.",
  privateNoteTooLong: "یادداشت دبیر حداکثر ۱۰۰۰ نویسه است.",
  nextPlanTooLong: "برنامهٴ جلسهٴ بعد حداکثر ۳۰۰ نویسه است.",
  noLesson: "برای این زنگ درسی در برنامهٴ کلاسی نیست؛ گزارش جلسه برای زنگِ بدون درس ثبت نمی‌شود.",
  workItemInvalid: "تکلیف انتخاب‌شده برای این درس نیست.",
  nothingToClear: "گزارشی برای این جلسه ثبت نشده است.",
  badDate: "تاریخ نامعتبر است.",
  futureDate: "برای روز آینده نمی‌توان گزارش جلسه ثبت کرد.",
  /** The درس the page was opened for is no longer the timetable's at that زنگ (security review 2026-10-20, F1). */
  lessonChanged: "درسِ این زنگ در برنامهٴ کلاسی عوض شده است؛ صفحه را دوباره باز کنید.",
  /** «دفتر کلاسی» is switched off for the school (feature switch `class_register`). */
  switchedOff: "دفتر کلاسی در این مدرسه خاموش است.",
} as const;

/** One line of free text: Persian-normalised, whitespace collapsed; empty becomes null. */
export function cleanReportLine(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const t = normalizeFa(input);
  return t === "" ? null : t;
}

/** A note that may span lines: each line normalised, runs of blank lines collapsed to one, ends trimmed; empty becomes null. */
export function cleanReportNote(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const t = input
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => normalizeFa(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t === "" ? null : t;
}

/** What a reader gets: no private note. A student, a guardian and any staff member without the write permission get exactly this shape. */
export interface SessionReportPublic {
  id: string;
  date: string;
  periodNo: number;
  topic: string;
  pageRef: string | null;
  nextPlan: string | null;
  workItem: { id: string; title: string } | null;
}

/** What the writers (the session's دبیر, the school's admins) get: the same plus the private «یادداشت دبیر». */
export interface SessionReportStaff extends SessionReportPublic {
  privateNote: string | null;
}

/**
 * The ONE place that decides which fields leave the service for a reader. A viewer without the write permission gets
 * an object that does not even HAVE a `privateNote` key — it can never reach a page's props, a JSON payload or a log.
 */
export function shapeSessionReport(row: SessionReportStaff, canSeePrivate: boolean): SessionReportPublic | SessionReportStaff {
  const { privateNote, ...rest } = row;
  return canSeePrivate ? { ...rest, privateNote } : rest;
}

/** Type guard for the page: does this report carry the private note? */
export function hasPrivateNote(report: SessionReportPublic | SessionReportStaff): report is SessionReportStaff {
  return "privateNote" in report;
}

/**
 * The audit trail's snapshot of a report: ids and text LENGTHS only (docs/decisions.md 2026-10-20) — never the topic,
 * the page, the next plan or the private note, so a teacher's words cannot leak through the append-only log.
 */
export function reportAuditShape(r: {
  classGroupId: string;
  classOfferingId: string;
  date: string;
  periodNo: number;
  workItemId: string | null;
  topic: string;
  pageRef: string | null;
  privateNote: string | null;
  nextPlan: string | null;
}) {
  return {
    classGroupId: r.classGroupId,
    classOfferingId: r.classOfferingId,
    date: r.date,
    periodNo: r.periodNo,
    workItemId: r.workItemId,
    topicLength: r.topic.length,
    pageRefLength: r.pageRef?.length ?? 0,
    privateNoteLength: r.privateNote?.length ?? 0,
    nextPlanLength: r.nextPlan?.length ?? 0,
  };
}
