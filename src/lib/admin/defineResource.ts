// The generic admin resource: one definition drives a list page (search, 50/page, sort by name), a create/edit
// form (Dialog on desktop, bottom Sheet on phones) driven by `formFields`, and an archive with confirm. One
// server action (`adminResourceMutate`, src/lib/admin/actions.ts) and one query (`adminResourceList`) serve every
// resource: the definition supplies the permission, the strict Zod schema, the scope filter and the service
// calls. Kept deliberately small — no react-table, no client-side state beyond the open form.
import type { z } from "zod";
import type { Tx } from "@/lib/actions";
import type { Ctx } from "@/lib/ctx";
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
  permission: { read: Permission; write: Permission };
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
  list: (tx: Tx, ctx: ResourceCtx, scope: AdminScope, opts: ListOptions) => Promise<ListResult<TRow>>;
  loadOptions?: (tx: Tx, ctx: ResourceCtx, scope: AdminScope, parent?: string) => Promise<Record<string, SelectOption[]>>;
  create: (tx: Tx, ctx: ResourceCtx, scope: AdminScope, input: TInput) => Promise<{ id: string }>;
  update: (tx: Tx, ctx: ResourceCtx, scope: AdminScope, id: string, input: TInput) => Promise<void>;
  archive?: { labelFa: string; confirmFa: string; run: (tx: Tx, ctx: ResourceCtx, scope: AdminScope, id: string) => Promise<void> };
  /** Initial form values of a row (defaults to the row's own fields by name). */
  formValues?: (row: TRow) => Record<string, string | number | boolean | null>;
  /** Detail page of a row, if any. */
  rowHref?: (row: TRow) => string;
  /** Extra links shown above the table (e.g. «شعبه‌ها» from schools). */
  links?: Array<{ href: string; labelFa: string }>;
}

export const PAGE_SIZE = 50;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyResourceDef = ResourceDef<any, any>;

/** Identity helper that keeps `TRow` / `TInput` inferred from the definition. */
export function defineResource<TRow extends { id: string }, TInput>(def: ResourceDef<TRow, TInput>): ResourceDef<TRow, TInput> {
  return def;
}
