// «نقش جدید» on /admin/roles — the ONE place a manager role is granted (owner, 2026-09-27: the staff pages show
// roles, they never change them). Pure, so the shape of the dialog is unit-tested (tests/unit/role-grant-ui.test.ts).
// The pickers carry only the caller's own options — `roleGrantOptions` and `roleGrantCandidates`, computed on the
// server from the same rule `assignRole` re-runs — and a required picker with one possible value is not a question
// (`isSettled`: a school manager's only role «معاون», a one-school scope's only school). The PERSON is the exception:
// the dialog always shows who receives the role, even when the scope holds one colleague.
import { newLabelFa, type FormField, type SelectOption } from "@/lib/admin/defineResource";
import { roleLabel } from "@/lib/admin/labels";
import type { RoleGrantOptions } from "@/modules/iam/service";
import { isSettled, seedValues, type FormValue } from "./resource-form-state";

export const GRANT_ROLE_FIELDS: FormField[] = [
  { name: "personId", labelFa: "همکار", type: "select", optionsKey: "people", required: true },
  { name: "roleCode", labelFa: "نقش", type: "select", optionsKey: "roles", required: true },
  { name: "schoolId", labelFa: "مدرسه", type: "select", optionsKey: "schools", required: true },
];

export interface GrantRoleForm {
  /** «معاون جدید» when the caller may give exactly one role (every school manager), else «نقش جدید». */
  title: string;
  options: Record<string, SelectOption[]>;
  /** The pickers on screen, in order. */
  shown: FormField[];
  /** What the dialog opens with: the one value of every settled picker. */
  initial: Record<string, FormValue>;
}

export function grantRoleForm(roleGrant: RoleGrantOptions<SelectOption>, candidates: readonly SelectOption[]): GrantRoleForm {
  const roles = roleGrant.roles.map((code) => ({ value: code, label: roleLabel(code) }));
  const options: Record<string, SelectOption[]> = {
    people: [...candidates],
    roles,
    schools: roleGrant.schools.map((s) => ({ value: s.value, label: s.label })),
  };
  return {
    title: newLabelFa(roles.length === 1 ? roles[0].label : "نقش"),
    options,
    shown: GRANT_ROLE_FIELDS.filter((f) => f.name === "personId" || !isSettled(f, options)),
    initial: seedValues(GRANT_ROLE_FIELDS, options),
  };
}

/** Client-side «… را انتخاب کنید.» for every picker on screen that is still empty (the server says the same, later). */
export function missingPicks(form: GrantRoleForm, values: Record<string, FormValue>): Record<string, string> {
  return Object.fromEntries(form.shown.filter((f) => values[f.name] === undefined || values[f.name] === null || values[f.name] === "").map((f) => [f.name, `${f.labelFa} را انتخاب کنید.`]));
}
