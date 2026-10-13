// Read-only queries for the «مشاوره» pages (Server Components). Same gate as the actions: session → must-change →
// strict input → the permission at ANY scope; the service decides the real scope INSIDE the transaction and answers
// NOT_FOUND outside it (the pages never tell «not yours» from «does not exist»).
import { defineQuery } from "@/lib/actions";
import { CounselingStudentsInput, StudentProfileIdInput, WorkItemIdInput } from "./dto";
import { counselingLinkForWorkItem, getStudentFile, getTeacherReportPage, listCounselingStudents } from "./service";

export type { CounselingLink, CounselingStudents, StudentFile, TeacherReportPage } from "./service";

/** «مشاوره»: the students of one school of the viewer's reach, grouped by پایه (`?school=`, `?q=`). */
export const counselingStudentsQuery = defineQuery({ schema: CounselingStudentsInput, permission: "counseling.case.read", scope: "any" }, async (tx, input, ctx) =>
  listCounselingStudents(tx, ctx, { schoolId: input.schoolId, q: input.q }),
);

/** «پروندهٴ مشاوره» of one student. */
export const studentFileQuery = defineQuery({ schema: StudentProfileIdInput, permission: "counseling.case.read", scope: "any" }, async (tx, input, ctx) =>
  getStudentFile(tx, ctx, input.studentProfileId),
);

/** The teacher's «گزارش به مشاور» page: the student (taught by them now) and their own earlier reports. */
export const teacherReportPageQuery = defineQuery({ schema: StudentProfileIdInput, permission: "counseling.teacher_report.write", scope: "any" }, async (tx, input, ctx) =>
  getTeacherReportPage(tx, ctx, input.studentProfileId),
);

/**
 * The work item page's way into «مشاوره» (`/inbox/[id]`): every reader of that page holds `workspace.work_item.read`;
 * whether THIS item leads anywhere for THIS reader is the service's call (null otherwise).
 */
export const counselingLinkQuery = defineQuery({ schema: WorkItemIdInput, permission: "workspace.work_item.read", scope: "any" }, async (tx, input, ctx) =>
  counselingLinkForWorkItem(tx, ctx, input.workItemId),
);
