// The catalog — permissions, system roles + their role_permission rows, system work item types + statuses and the
// notification types — and the ONE implementation that writes it, in plain SQL over a `pg`-shaped `query()`:
//
//   • `scripts/seed.ts --catalog` (pnpm seed, seed:demo, seed:pilot, the int tests) runs it through the pool of a
//     drizzle `Db` (`db.$client`);
//   • `scripts/seed-catalog.ts` is the CLI entry that `scripts/build-seed-catalog.ts` compiles at `pnpm build` into
//     `scripts/seed-catalog.js`, which the `seed` service of deploy/compose.yml runs inside the standalone image
//     right after `migrate` (`node scripts/seed-catalog.js`) — so a deploy that adds a permission or changes a role
//     matrix reaches the database without a manual step.
//
// Because the image has no drizzle-orm package (Next bundles it into the route chunks) this module may import
// ONLY `../src/modules/iam/permissions` (the permission catalog, import-free) and nothing else — the build fails
// loudly on any other bare import. Same statements, same code, whichever entry runs it: nothing to drift.
//
// Semantics (authoritative and idempotent, as before): permissions / types / statuses / notification types are
// upserted by their natural key; `role_permission` rows of a system role that are no longer listed are DELETED,
// stale statuses of a system type likewise; a second run changes nothing (tests/int/seed.test.ts). Runs as
// app_owner (MIGRATION_DATABASE_URL); the system rows have `organization_id IS NULL` (the `system_templates` RLS
// policy) so no tenant context is needed. New ids come from `app.uuid_generate_v7()` (migration 0000).
import { IMPLICIT_PERMISSIONS, PERMISSIONS, type Permission, type ScopeType } from "../src/modules/iam/permissions";

/** What `pg.Client`, `pg.PoolClient` and `pg.Pool` all offer; the only database surface this module uses. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

// ---------------------------------------------------------------------------------------------------------------
// data
// ---------------------------------------------------------------------------------------------------------------

const ALL_ROLE_PERMS: Permission[] = PERMISSIONS.map((p) => p.code).filter((c) => !IMPLICIT_PERMISSIONS.includes(c));
const WORK_ITEM_ALL: Permission[] = [
  "workspace.work_item.read",
  "workspace.work_item.create",
  "workspace.work_item.update",
  "workspace.work_item.comment",
  "workspace.work_item.assign_class",
];

export interface SystemRole {
  code: string;
  name: string;
  description: string;
  allowedScopeTypes: ScopeType[];
  permissions: Permission[];
}

/** System role templates (doc 03 §7). Custom roles are out of phase 1. */
export const SYSTEM_ROLES: SystemRole[] = [
  { code: "org_admin", name: "مدیر سازمان", description: "همهٴ دسترسی‌ها در سطح سازمان", allowedScopeTypes: ["organization"], permissions: ALL_ROLE_PERMS },
  // Holds `iam.role_assignment.write` too, but the service only lets a school-scoped admin grant/revoke `vice_principal`
  // at their own schools (owner's matrix: principals are appointed by the organization admin only), and
  // `tenancy.structure.write` never creates schools outside the organization scope (docs/admin.md).
  { code: "school_principal", name: "مدیر مدرسه", description: "همهٴ دسترسی‌ها در سطح یک مدرسه", allowedScopeTypes: ["school"], permissions: ALL_ROLE_PERMS },
  {
    code: "vice_principal",
    name: "معاون",
    description: "کارتابل، افراد، ثبت‌نام، حساب‌ها و تعیین دبیر در سطح مدرسه یا شعبه",
    allowedScopeTypes: ["school", "branch"],
    permissions: [
      "iam.admin.access",
      "tenancy.structure.read",
      "iam.person.read",
      "iam.person.write",
      "academic.enrollment.write",
      // Owner's matrix: a vice principal defines teachers — sets/changes the main teacher of EXISTING offerings and ends
      // teaching (the derived `teacher` role follows); defining offerings/structure stays `tenancy.structure.write`.
      "academic.teacher_assignment.write",
      // Owner: admins (principal + vice) define each class's weekly schedule; the bell schedule itself is structure.
      "academic.timetable.read",
      "academic.timetable.write",
      "iam.account.reset_password",
      "iam.account.unlock",
      ...WORK_ITEM_ALL,
      "notif.notification.read",
    ],
  },
  {
    code: "teacher",
    name: "معلم",
    description: "کارتابل درس‌های خود",
    allowedScopeTypes: ["class_offering", "class_group"],
    permissions: [...WORK_ITEM_ALL, "notif.notification.read", "iam.person.read", "academic.timetable.read"],
  },
  {
    code: "student",
    name: "دانش‌آموز",
    description: "کارتابل خود",
    allowedScopeTypes: ["student"],
    permissions: ["workspace.work_item.read", "workspace.work_item.update", "workspace.work_item.comment", "notif.notification.read", "academic.timetable.read"],
  },
  {
    code: "guardian_full",
    name: "ولی",
    description: "مشاهدهٴ کارتابل فرزند",
    allowedScopeTypes: ["student", "family"],
    permissions: ["workspace.work_item.read", "workspace.work_item.comment", "notif.notification.read", "academic.timetable.read"],
  },
];

export type StatusCategory = "todo" | "doing" | "done" | "cancelled";
export interface SystemStatus {
  code: string;
  name: string;
  category: StatusCategory;
  sequence: number;
  isTerminal?: boolean;
}
export interface SystemWorkItemType {
  code: string;
  name: string;
  requiresAssignee: boolean;
  allowRecurrence?: boolean;
  statuses: SystemStatus[];
}

const STANDARD_STATUSES: SystemStatus[] = [
  { code: "open", name: "باز", category: "todo", sequence: 1 },
  { code: "in_progress", name: "در حال انجام", category: "doing", sequence: 2 },
  { code: "done", name: "انجام‌شده", category: "done", sequence: 3, isTerminal: true },
  { code: "cancelled", name: "کنسل‌شده", category: "cancelled", sequence: 4, isTerminal: true },
];

/** System work item types (organization_id NULL). Statuses are authoritative: stale codes of a type are removed. */
export const SYSTEM_WORK_ITEM_TYPES: SystemWorkItemType[] = [
  { code: "todo", name: "کار شخصی", requiresAssignee: false, statuses: STANDARD_STATUSES },
  { code: "task", name: "تکلیف", requiresAssignee: true, statuses: STANDARD_STATUSES },
  {
    code: "admin_request",
    name: "درخواست اداری",
    requiresAssignee: true,
    statuses: [
      { code: "open", name: "باز", category: "todo", sequence: 1 },
      { code: "in_review", name: "در حال بررسی", category: "doing", sequence: 2 },
      { code: "answered", name: "پاسخ‌داده‌شده", category: "done", sequence: 3, isTerminal: true },
      { code: "rejected", name: "ردشده", category: "cancelled", sequence: 4, isTerminal: true },
    ],
  },
  // The spec lists no statuses for `reminder`; it behaves like a personal todo (recurrence allowed later).
  { code: "reminder", name: "یادآوری", requiresAssignee: false, allowRecurrence: true, statuses: STANDARD_STATUSES },
  {
    code: "approval",
    name: "تأیید",
    requiresAssignee: true,
    statuses: [
      { code: "pending", name: "در انتظار", category: "todo", sequence: 1 },
      { code: "approved", name: "تأییدشده", category: "done", sequence: 2, isTerminal: true },
      { code: "rejected", name: "ردشده", category: "cancelled", sequence: 3, isTerminal: true },
    ],
  },
];

export interface SystemNotificationType {
  code: string;
  module: string;
  name: string;
  urgency?: "low" | "normal" | "high";
  userCanDisable?: boolean;
}

export const NOTIFICATION_TYPES: SystemNotificationType[] = [
  { code: "work_item.assigned", module: "workspace", name: "کار جدید به شما سپرده شد" },
  { code: "work_item.comment", module: "workspace", name: "نظر جدید روی کار" },
  { code: "work_item.status_changed", module: "workspace", name: "وضعیت کار تغییر کرد" },
  { code: "work_item.due_extended", module: "workspace", name: "مهلت تکلیف تمدید شد" },
  { code: "work_item.due_soon", module: "workspace", name: "مهلت کار نزدیک است", urgency: "high" },
  { code: "account.password_reset", module: "iam", name: "رمز حساب بازنشانی شد", urgency: "high", userCanDisable: false },
  { code: "system.announcement", module: "system", name: "اطلاعیهٴ سامانه", userCanDisable: false },
];

export interface CatalogCounts {
  permissions: number;
  roles: number;
  workItemTypes: number;
  workItemStatuses: number;
  notificationTypes: number;
}

// ---------------------------------------------------------------------------------------------------------------
// writer
// ---------------------------------------------------------------------------------------------------------------

async function seedWorkItemTypes(q: Queryable): Promise<void> {
  for (const t of SYSTEM_WORK_ITEM_TYPES) {
    const res = await q.query(
      `insert into workspace.work_item_type (id, organization_id, code, name, requires_assignee, allow_recurrence)
       values (app.uuid_generate_v7(), null, $1, $2, $3, $4)
       on conflict (organization_id, code) do update
         set name = excluded.name, requires_assignee = excluded.requires_assignee, allow_recurrence = excluded.allow_recurrence
       returning id`,
      [t.code, t.name, t.requiresAssignee, t.allowRecurrence ?? false],
    );
    const typeId = String(res.rows[0].id);
    for (const st of t.statuses) {
      await q.query(
        `insert into workspace.work_item_status (id, work_item_type_id, code, name, category, sequence, is_terminal)
         values (app.uuid_generate_v7(), $1, $2, $3, $4, $5, $6)
         on conflict (work_item_type_id, code) do update
           set name = excluded.name, category = excluded.category, sequence = excluded.sequence, is_terminal = excluded.is_terminal`,
        [typeId, st.code, st.name, st.category, st.sequence, st.isTerminal ?? false],
      );
    }
    await q.query(`delete from workspace.work_item_status where work_item_type_id = $1 and code <> all($2::text[])`, [typeId, t.statuses.map((st) => st.code)]);
  }
}

async function seedNotificationTypes(q: Queryable): Promise<void> {
  for (const n of NOTIFICATION_TYPES) {
    await q.query(
      `insert into notif.notification_type (code, module, name, urgency, user_can_disable)
       values ($1, $2, $3, $4, $5)
       on conflict (code) do update
         set module = excluded.module, name = excluded.name, urgency = excluded.urgency, user_can_disable = excluded.user_can_disable`,
      [n.code, n.module, n.name, n.urgency ?? "normal", n.userCanDisable ?? true],
    );
  }
}

async function seedPermissions(q: Queryable): Promise<void> {
  for (const p of PERMISSIONS) {
    await q.query(
      `insert into iam.permission (code, module, name, is_sensitive)
       values ($1, $2, $3, $4)
       on conflict (code) do update set module = excluded.module, name = excluded.name, is_sensitive = excluded.is_sensitive`,
      [p.code, p.module, p.name, p.isSensitive],
    );
  }
}

async function seedRoles(q: Queryable): Promise<Record<string, string>> {
  const roleIds: Record<string, string> = {};
  for (const r of SYSTEM_ROLES) {
    const res = await q.query(
      `insert into iam.role (id, organization_id, code, name, description, is_system, allowed_scope_types)
       values (app.uuid_generate_v7(), null, $1, $2, $3, true, $4::text[])
       on conflict (organization_id, code) do update
         set name = excluded.name, description = excluded.description, is_system = true, allowed_scope_types = excluded.allowed_scope_types
       returning id`,
      [r.code, r.name, r.description, r.allowedScopeTypes],
    );
    const roleId = String(res.rows[0].id);
    roleIds[r.code] = roleId;
    if (r.permissions.length > 0) {
      await q.query(
        `insert into iam.role_permission (role_id, permission_code)
         select $1::uuid, unnest($2::text[])
         on conflict do nothing`,
        [roleId, r.permissions],
      );
      await q.query(`delete from iam.role_permission where role_id = $1 and permission_code <> all($2::text[])`, [roleId, r.permissions]);
    } else {
      await q.query(`delete from iam.role_permission where role_id = $1`, [roleId]);
    }
  }
  return roleIds;
}

/**
 * Writes the whole catalog in ONE transaction on `q` (BEGIN … COMMIT; ROLLBACK on any error) and returns the
 * system role ids by code. `q` must be a single connection (a `pg.Client` or a checked-out `PoolClient`) — a pool
 * would spread the transaction over connections.
 */
export async function seedCatalogWith(q: Queryable): Promise<Record<string, string>> {
  await q.query("BEGIN");
  try {
    await seedWorkItemTypes(q);
    await seedNotificationTypes(q);
    await seedPermissions(q);
    const roleIds = await seedRoles(q);
    await q.query("COMMIT");
    return roleIds;
  } catch (err) {
    await q.query("ROLLBACK");
    throw err;
  }
}

/**
 * Row counts of the catalog tables (printed by the CLIs; asserted by tests/int/seed.test.ts for idempotency).
 * `roles` / `workItemTypes` count the system templates only (organization_id IS NULL) — tenant rows are invisible
 * to app_owner without a tenant context anyway (FORCE RLS).
 */
export async function catalogCountsWith(q: Queryable): Promise<CatalogCounts> {
  const count = async (table: string, where = ""): Promise<number> => {
    const res = await q.query(`select count(*)::int as n from ${table} ${where}`);
    return Number(res.rows[0].n);
  };
  return {
    permissions: await count("iam.permission"),
    roles: await count("iam.role", "where organization_id is null"),
    workItemTypes: await count("workspace.work_item_type", "where organization_id is null"),
    workItemStatuses: await count("workspace.work_item_status"),
    notificationTypes: await count("notif.notification_type"),
  };
}

/** The one summary line both CLIs print (`[seed] catalog: …`). */
export function formatCatalogSummary(c: CatalogCounts): string {
  return `[seed] catalog: ${c.permissions} permissions, ${c.roles} system roles, ${c.workItemTypes} system work item types, ${c.workItemStatuses} statuses, ${c.notificationTypes} notification types`;
}
