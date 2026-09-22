// The generic admin resource: one definition drives a list page (search, 50/page, sort by name), a create/edit
// form (Dialog on desktop, bottom Sheet on phones) driven by `formFields`, and an archive with confirm. One
// server action (`adminResourceMutate`, src/lib/admin/actions.ts) and one query (`adminResourceList`) serve every
// resource: the definition supplies the permission, the strict Zod schema, the scope filter and the service
// calls. Kept deliberately small — no react-table, no client-side state beyond the open form.
import type { z } from "zod";
import type { Tx } from "@/lib/actions";
import type { Ctx } from "@/lib/ctx";
import { canAtAnyScope, type Assignment } from "@/modules/iam/can";
import type { Permission } from "@/modules/iam/permissions";
import type { AdminScope } from "@/modules/iam/service";

export type FieldType = "text" | "select" | "jalali_date" | "toggle" | "number";

export interface SelectOption {
  value: string;
  label: string;
  /** Optional `<optgroup>` label. */
  group?: string;
}

/** Serializable — crosses to the client form component. */
export interface FormField {
  name: string;
  labelFa: string;
  type: FieldType;
  /** Static options, or the key of an option set returned by `loadOptions`. */
  options?: SelectOption[];
  optionsKey?: string;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  /** Latin-script value (codes, phones): render `dir="ltr"`. */
  ltr?: boolean;
  /** Shown (and sent) only when creating; edits never change it (natural keys). */
  createOnly?: boolean;
  /** Numeric keyboard on phones. */
  numeric?: boolean;
}

export interface Column<TRow> {
  key: string;
  labelFa: string;
  render?: (row: TRow) => React.ReactNode;
  className?: string;
  /** Hide below `md`. */
  secondary?: boolean;
  /**
   * Phones show each row as a card: the first column as the title and the columns marked here as two meta lines
   * (`1` — or `true` — and `2`; columns of one line join with « · »). A boolean column contributes its label when
   * true («جاری», «پیش‌فرض») and nothing otherwise.
   */
  mobileMeta?: boolean | 1 | 2;
}

export interface ListOptions {
  q: string;
  page: number;
  pageSize: number;
  /** Value of the `parentParam` query string (e.g. the academic year of a terms list). */
  parent?: string;
}

export interface ListResult<TRow> {
  rows: TRow[];
  total: number;
}

export type ResourceCtx = Pick<Ctx, "orgId" | "personId" | "userId" | "requestId" | "ip" | "userAgent" | "assignments">;

export interface ResourceDef<TRow extends { id: string }, TInput> {
  /** URL segment under /admin, e.g. `schools`. */
  key: string;
  labelFa: string;
  labelFaPlural: string;
  /** One line under the title. */
  descriptionFa?: string;
  /**
   * `write` gates update/archive (and create unless `create` is set). `create` lets a resource demand a stronger
   * permission for NEW rows than for edits — offerings: a vice principal (`academic.teacher_assignment.write`) edits
   * the main teacher of existing rows, only `tenancy.structure.write` defines new ones.
   */
  permission: { read: Permission; write: Permission; create?: Permission };
  /** Organization-level catalog (levels, grades, subjects): school-scoped admins see it read-only. */
  orgOnly?: boolean;
  /** Creating needs an organization-scoped admin even though rows are school-owned (schools themselves). */
  createNeedsOrgScope?: boolean;
  /** Lists filtered by a parent id from the query string (`?year=<id>` for terms). */
  parentParam?: { name: string; field: string; labelFa: string; backHref: (parent: string) => string };
  columns: Column<TRow>[];
  /** `.strict()` create/edit input; also validates the data of `adminResourceMutate`. */
  schema: z.ZodType<TInput>;
  formFields: FormField[];
  /**
   * The fields for a GIVEN option set, when the options decide what the control is and what to call it — the class
   * form's location picker is «مدرسه» over school names while every school has one branch, and «مدرسه / شعبه» over
   * branch names grouped by school once one of them has two. Same field `name` (same payload) in every shape.
   * Defaults to `formFields`; read through `formFieldsOf`.
   */
  formFieldsFor?: (options: Record<string, SelectOption[]>) => FormField[];
  list: (tx: Tx, ctx: ResourceCtx, scope: AdminScope, opts: ListOptions) => Promise<ListResult<TRow>>;
  loadOptions?: (tx: Tx, ctx: ResourceCtx, scope: AdminScope, parent?: string) => Promise<Record<string, SelectOption[]>>;
  create: (tx: Tx, ctx: ResourceCtx, scope: AdminScope, input: TInput) => Promise<{ id: string }>;
  update: (tx: Tx, ctx: ResourceCtx, scope: AdminScope, id: string, input: TInput) => Promise<void>;
  archive?: { labelFa: string; confirmFa: string; run: (tx: Tx, ctx: ResourceCtx, scope: AdminScope, id: string) => Promise<void> };
  /** Initial form values of a row (defaults to the row's own fields by name). */
  formValues?: (row: TRow) => Record<string, string | number | boolean | null>;
  /** Detail page of a row, if any. */
  rowHref?: (row: TRow) => string;
  /** A printable page of a row («چاپ» in the row menu), e.g. a class's credentials sheet. */
  printHref?: (row: TRow) => string;
  /** Extra links shown above the table (e.g. «شعبه‌ها» from schools). */
  links?: Array<{ href: string; labelFa: string }>;
}

export const PAGE_SIZE = 50;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyResourceDef = ResourceDef<any, any>;

/** The form fields of a resource for the options at hand (`formFieldsFor`, else the static list). */
export function formFieldsOf(def: AnyResourceDef, options: Record<string, SelectOption[]>): FormField[] {
  return def.formFieldsFor ? def.formFieldsFor(options) : def.formFields;
}

/** Identity helper that keeps `TRow` / `TInput` inferred from the definition. */
export function defineResource<TRow extends { id: string }, TInput>(def: ResourceDef<TRow, TInput>): ResourceDef<TRow, TInput> {
  return def;
}

export type ResourceOp = "create" | "update" | "archive";

/** «مدرسهٴ جدید» / «کلاس جدید»: the written ezafe (ٴ) only after a final heh. */
export const newLabelFa = (labelFa: string): string => `${labelFa}${labelFa.endsWith("ه") ? "ٴ" : ""} جدید`;
/** «مدرسه‌ای» / «کلاسی»: the indefinite suffix. */
export const indefiniteFa = (labelFa: string): string => `${labelFa}${labelFa.endsWith("ه") ? "‌ای" : "ی"}`;

export const GATE_MESSAGES = {
  orgOnly: "این بخش را فقط مدیر سازمان می‌تواند ویرایش کند.",
  createNeedsOrgScope: (labelFa: string) => `ساختن ${newLabelFa(labelFa)} فقط با مدیر سازمان است.`,
} as const;

/** `ok: false` = refuse with FORBIDDEN (the action throws it, the list page hides the button); `message` when there is one worth showing. */
export type GateVerdict = { ok: true } | { ok: false; message?: string };

/**
 * The ONE decision «may this caller perform `op` on `def`?» shared by the mutation action (throws) and the list
 * query (hides buttons), BEFORE any row is read: the op's permission at any scope (`permission.create` for new rows
 * when set, else `write`), then the organization-scope requirements (`orgOnly`, `createNeedsOrgScope`). The
 * resource's own handler applies the row-level scope rule afterwards (out of scope = NOT_FOUND, never FORBIDDEN).
 */
export function resourceOpGate(def: AnyResourceDef, op: ResourceOp, assignments: readonly Assignment[], scope: AdminScope): GateVerdict {
  const needed: Permission = op === "create" ? (def.permission.create ?? def.permission.write) : def.permission.write;
  if (!canAtAnyScope(assignments, needed)) return { ok: false };
  if (def.orgOnly && scope.kind !== "organization") return { ok: false, message: GATE_MESSAGES.orgOnly };
  if (op === "create" && def.createNeedsOrgScope && scope.kind !== "organization") return { ok: false, message: GATE_MESSAGES.createNeedsOrgScope(def.labelFa) };
  return { ok: true };
}
