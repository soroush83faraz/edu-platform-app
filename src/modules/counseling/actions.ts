"use server";
// «مشاوره» Server Actions. Every one goes through defineAction (session → must-change → strict Zod → the permission
// at ANY scope → tenant transaction); the service decides the real scope inside — the student's school for a
// counselor, the teaching for a teacher — and answers NOT_FOUND outside it. Nothing from the client reaches a
// query unmapped; the author, the school and the organization come from the session and the database.
import { defineAction } from "@/lib/actions";
import { CreateNoteInput, CreateTeacherReportInput, NoteIdInput, ReferInput, ReportIdInput, RequestReportInput, UpdateNoteInput } from "./dto";
import {
  archiveCounselorNote,
  archiveTeacherReport,
  createCounselorNote,
  createTeacherReport,
  referToManagement,
  requestTeacherReport,
  updateCounselorNote,
} from "./service";

export const createCounselorNoteAction = defineAction({ schema: CreateNoteInput, permission: "counseling.note.write", scope: "any" }, async (tx, input, ctx) =>
  createCounselorNote(tx, ctx, { studentProfileId: input.studentProfileId, kind: input.kind, visibility: input.visibility, body: input.body }),
);

export const updateCounselorNoteAction = defineAction({ schema: UpdateNoteInput, permission: "counseling.note.write", scope: "any" }, async (tx, input, ctx) =>
  updateCounselorNote(tx, ctx, { noteId: input.noteId, kind: input.kind, visibility: input.visibility, body: input.body }),
);

export const archiveCounselorNoteAction = defineAction({ schema: NoteIdInput, permission: "counseling.note.write", scope: "any" }, async (tx, input, ctx) =>
  archiveCounselorNote(tx, ctx, { noteId: input.noteId }),
);

export const createTeacherReportAction = defineAction({ schema: CreateTeacherReportInput, permission: "counseling.teacher_report.write", scope: "any" }, async (tx, input, ctx) =>
  createTeacherReport(tx, ctx, { studentProfileId: input.studentProfileId, kind: input.kind, body: input.body }),
);

export const archiveTeacherReportAction = defineAction({ schema: ReportIdInput, permission: "counseling.teacher_report.write", scope: "any" }, async (tx, input, ctx) =>
  archiveTeacherReport(tx, ctx, { reportId: input.reportId }),
);

export const referToManagementAction = defineAction({ schema: ReferInput, permission: "counseling.referral.create", scope: "any" }, async (tx, input, ctx) =>
  referToManagement(tx, ctx, {
    studentProfileId: input.studentProfileId,
    subject: input.subject,
    description: input.description ?? null,
    urgent: input.urgent,
    idempotencyKey: input.idempotencyKey ?? null,
  }),
);

export const requestTeacherReportAction = defineAction({ schema: RequestReportInput, permission: "counseling.referral.create", scope: "any" }, async (tx, input, ctx) =>
  requestTeacherReport(tx, ctx, {
    studentProfileId: input.studentProfileId,
    teacherPersonIds: input.teacherPersonIds,
    message: input.message ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
  }),
);
