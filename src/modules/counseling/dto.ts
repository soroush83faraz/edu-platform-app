// Zod v4 `.strict()` inputs of the counseling actions and queries. Persian messages; nothing here is spread into a
// query — the service maps every field explicitly, and the author, the school and the organization come from the
// session and the database, never from these.
import { z } from "zod";
import { NOTE_KINDS, NOTE_MAX, NOTE_VISIBILITIES, REFERRAL_BODY_MAX, REFERRAL_SUBJECT_MAX, REPORT_KINDS, REPORT_MAX, REQUEST_MESSAGE_MAX } from "./policy";

const uuid = z.uuid("شناسه نامعتبر است.");
const max = (n: number) => `حداکثر ${n.toLocaleString("fa-IR")} نویسه.`;

export const CounselingStudentsInput = z
  .object({
    schoolId: uuid.optional(),
    q: z.string().trim().max(80, max(80)).optional(),
  })
  .strict();

export const StudentProfileIdInput = z.object({ studentProfileId: uuid }).strict();

export const WorkItemIdInput = z.object({ workItemId: uuid }).strict();

export const CreateNoteInput = z
  .object({
    studentProfileId: uuid,
    kind: z.enum(NOTE_KINDS).default("general"),
    visibility: z.enum(NOTE_VISIBILITIES).default("counselors_and_principal"),
    body: z.string().trim().min(1, "متن یادداشت را وارد کنید.").max(NOTE_MAX, max(NOTE_MAX)),
  })
  .strict();

/** A PATCH: omitted fields are kept. */
export const UpdateNoteInput = z
  .object({
    noteId: uuid,
    kind: z.enum(NOTE_KINDS).optional(),
    visibility: z.enum(NOTE_VISIBILITIES).optional(),
    body: z.string().trim().min(1, "متن یادداشت را وارد کنید.").max(NOTE_MAX, max(NOTE_MAX)).optional(),
  })
  .strict();

export const NoteIdInput = z.object({ noteId: uuid }).strict();

export const CreateTeacherReportInput = z
  .object({
    studentProfileId: uuid,
    kind: z.enum(REPORT_KINDS, "نوع گزارش را انتخاب کنید."),
    body: z.string().trim().min(1, "متن گزارش را وارد کنید.").max(REPORT_MAX, max(REPORT_MAX)),
  })
  .strict();

export const ReportIdInput = z.object({ reportId: uuid }).strict();

export const ReferInput = z
  .object({
    studentProfileId: uuid,
    subject: z.string().trim().min(1, "موضوع ارجاع را وارد کنید.").max(REFERRAL_SUBJECT_MAX, max(REFERRAL_SUBJECT_MAX)),
    description: z.string().trim().max(REFERRAL_BODY_MAX, max(REFERRAL_BODY_MAX)).optional(),
    urgent: z.boolean().default(false),
    /** UUID v7 minted when the form opens; a resubmit within 10 minutes returns the referral already made. */
    idempotencyKey: uuid.optional(),
  })
  .strict();

export const RequestReportInput = z
  .object({
    studentProfileId: uuid,
    teacherPersonIds: z.array(uuid).min(1, "دست‌کم یک دبیر را انتخاب کنید.").max(30),
    message: z.string().trim().max(REQUEST_MESSAGE_MAX, max(REQUEST_MESSAGE_MAX)).optional(),
    idempotencyKey: uuid.optional(),
  })
  .strict();
