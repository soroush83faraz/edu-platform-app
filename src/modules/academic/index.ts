// Public surface of the academic module. Re-export only what other modules may use.
export {
  assignTeacher,
  endTeacherAssignment,
  enrollStudent,
  moveEnrollment,
  type AssignTeacherInput,
  type AssignTeacherResult,
  type EndTeacherAssignmentInput,
  type EnrollStudentInput,
  type EnrollStudentResult,
  type EnrollmentChangeReason,
  type MoveEnrollmentInput,
  type ServiceCtx,
  type TeacherRole,
} from "./service";
