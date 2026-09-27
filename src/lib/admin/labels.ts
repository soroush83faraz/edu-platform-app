// Pure Persian labels shared by server and client admin components (no server-only imports here).
const ROLE_LABELS: Record<string, string> = {
  org_admin: "مدیر سازمان",
  school_principal: "مدیر مدرسه",
  vice_principal: "معاون",
  teacher: "دبیر",
  student: "دانش‌آموز",
  guardian_full: "ولی",
};

export const roleLabel = (code: string): string => ROLE_LABELS[code] ?? code;

/** Teaching roles of a `teacher_assignment` (the «تدریس» section and «افزودن تدریس»). */
export const TEACHER_ROLE_LABELS: Record<string, string> = { main: "دبیر اصلی", assistant: "دبیر کمکی", substitute: "دبیر جانشین" };
export const teacherRoleLabel = (role: string): string => TEACHER_ROLE_LABELS[role] ?? role;

/** Answers of «افزودن تدریس» (src/lib/admin/teaching.ts); the dialog matches `mainTaken` to show its confirm step. */
export const TEACHING_MESSAGES = {
  /** CONFLICT without `replaceMain` — the dialog turns it into its confirm step. */
  mainTaken: "این درس قبلاً دبیر اصلی دارد؛ جایگزین شود؟",
  /** One active teaching per colleague and offering (the derived «دبیر» role is unique per person × offering). */
  alreadyTeaches: "این همکار هم‌اکنون در همین درس تدریس دارد؛ برای تغییر نقش، اول «پایان تدریس» را بزنید.",
  notStaff: "فقط همکارِ فعال را می‌توان دبیر درس کرد.",
  pickClass: "کلاس را انتخاب کنید.",
  pickSubject: "درس را انتخاب کنید.",
  classNotCurrent: "تدریس فقط در کلاس‌های فعالِ سال تحصیلی جاری تعیین می‌شود.",
  noTerm: "برای سال تحصیلی این کلاس نوبتی تعریف نشده است.",
} as const;
