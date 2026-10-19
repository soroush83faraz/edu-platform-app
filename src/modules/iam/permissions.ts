/**
 * Permission catalog — the single source of truth for `iam.permission` (seeded by `scripts/seed.ts --catalog`)
 * and for the `Permission` type every `defineAction` must name. Codes are `module.resource.action`.
 * Adding a permission = add a row here + re-run the catalog seed; nothing else.
 */
export const PERMISSIONS = [
  /** Implicit: every authenticated member holds it (own password, own sessions) — never stored in role_permission. */
  { code: "iam.account.self", module: "iam", name: "مدیریت حساب خود", isSensitive: false },
  { code: "iam.admin.access", module: "iam", name: "دسترسی به بخش مدیریت کاربران", isSensitive: true },
  { code: "iam.person.read", module: "iam", name: "مشاهدهٴ افراد", isSensitive: false },
  { code: "iam.person.write", module: "iam", name: "ایجاد و ویرایش افراد", isSensitive: true },
  { code: "iam.role_assignment.write", module: "iam", name: "تخصیص و لغو نقش", isSensitive: true },
  { code: "iam.account.reset_password", module: "iam", name: "بازنشانی رمز حساب کاربری", isSensitive: true },
  { code: "iam.account.unlock", module: "iam", name: "رفع قفل حساب کاربری", isSensitive: true },
  { code: "tenancy.structure.read", module: "tenancy", name: "مشاهدهٴ ساختار مدرسه", isSensitive: false },
  { code: "tenancy.structure.write", module: "tenancy", name: "ویرایش ساختار مدرسه", isSensitive: true },
  { code: "academic.enrollment.write", module: "academic", name: "ثبت‌نام دانش‌آموز در کلاس", isSensitive: false },
  { code: "academic.teacher_assignment.write", module: "academic", name: "تخصیص معلم به درس", isSensitive: false },
  { code: "academic.timetable.read", module: "academic", name: "مشاهدهٴ برنامهٴ کلاسی", isSensitive: false },
  { code: "academic.timetable.write", module: "academic", name: "تنظیم برنامهٴ کلاسی", isSensitive: false },
  { code: "academic.attendance.read", module: "academic", name: "مشاهدهٴ حضور و غیاب", isSensitive: false },
  { code: "academic.attendance.write", module: "academic", name: "ثبت حضور و غیاب", isSensitive: false },
  { code: "academic.attendance.report", module: "academic", name: "گزارش حضور و غیاب", isSensitive: false },
  { code: "academic.objective_rating.read", module: "academic", name: "مشاهدهٴ کارنامهٴ توصیفی", isSensitive: false },
  { code: "academic.objective_rating.write", module: "academic", name: "ثبت کارنامهٴ توصیفی", isSensitive: false },
  { code: "workspace.work_item.read", module: "workspace", name: "مشاهدهٴ کارتابل", isSensitive: false },
  { code: "workspace.work_item.create", module: "workspace", name: "ایجاد کار", isSensitive: false },
  { code: "workspace.work_item.update", module: "workspace", name: "ویرایش کار", isSensitive: false },
  { code: "workspace.work_item.comment", module: "workspace", name: "ثبت نظر روی کار", isSensitive: false },
  { code: "workspace.work_item.assign_class", module: "workspace", name: "ارسال کار به کلاس", isSensitive: false },
  { code: "notif.notification.read", module: "notif", name: "مشاهدهٴ اعلان‌ها", isSensitive: false },
  { code: "integ.import.write", module: "integ", name: "ورود اطلاعات از اکسل", isSensitive: true },
  // «مشاوره» (owner, 2026-10-13; docs/decisions.md «مشاوره — فاز ۱»). Read = the student file (profile, academic summary,
  // the notes its visibility allows, teacher reports, referrals) — the counselor and the school's management.
  // The counselor's own writes and the teacher's report are NEVER a manager's (scripts/catalog.ts `NON_MANAGER_PERMS`).
  { code: "counseling.case.read", module: "counseling", name: "مشاهدهٴ پروندهٴ مشاوره", isSensitive: true },
  { code: "counseling.note.write", module: "counseling", name: "ثبت یادداشت مشاور", isSensitive: true },
  { code: "counseling.referral.create", module: "counseling", name: "ارجاع به مدیریت و درخواست گزارش از دبیر", isSensitive: true },
  /** Who a referral «ارجاع به مدیریت» is addressed to: the school's managers (the organization admin when it has none). */
  { code: "counseling.referral.receive", module: "counseling", name: "دریافت ارجاع مشاور", isSensitive: false },
  { code: "counseling.teacher_report.write", module: "counseling", name: "ثبت گزارش برای مشاور", isSensitive: false },
  // «ارتباط ولی و مدرسه» (owner, 2026-10-19; docs/decisions.md): a guardian's question / suggestion / criticism about
  // ONE of their children to that child's teacher, counselor, vice principal or principal — held only by the derived
  // «ولی» role at the child's student scope (never a manager's: scripts/catalog.ts `NON_MANAGER_PERMS`), and every use
  // ALSO needs the live link (`requireChild`, src/modules/iam/guardian-messages.ts).
  { code: "iam.guardian_message.send", module: "iam", name: "پیام ولی به مدرسه", isSensitive: false },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["code"];

export const PERMISSION_CODES: readonly Permission[] = PERMISSIONS.map((p) => p.code);

/** Granted by being a member, not by a role. `can()` returns true for these without consulting assignments. */
export const IMPLICIT_PERMISSIONS: readonly Permission[] = ["iam.account.self"];

export function isPermission(code: string): code is Permission {
  return (PERMISSION_CODES as readonly string[]).includes(code);
}

/** Where a role_assignment may point. Mirrors `role_assignment_scope_type_chk`. */
export const SCOPE_TYPES = ["organization", "school", "branch", "class_group", "class_offering", "student", "family"] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

/** A reference to the thing an action operates on; `id` is validated against the tenant by `resolveScopeChain`. */
export interface ScopeRef {
  scopeType: Exclude<ScopeType, "organization">;
  id: string;
}
