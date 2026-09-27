"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useReducer, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { assignRoleAction } from "@/lib/admin/people-actions";
import type { SelectOption } from "@/lib/admin/defineResource";
import type { AssignableRole, RoleGrantOptions } from "@/modules/iam/service";
import { GRANT_ROLE_FIELDS, grantRoleForm, missingPicks } from "./grant-role-form";
import { Field, flatten } from "./ResourceForm";
import { CLOSED_SESSION, formSessionReducer } from "./resource-form-state";
import { ResponsiveModal } from "./ResponsiveModal";

/**
 * «معاون جدید» / «نقش جدید» — the primary action of /admin/roles and the ONLY control in the product that grants a
 * manager role (owner, 2026-09-27). The pickers hold the caller's own options, computed on the server
 * (`rolesPageQuery`); on submit the server re-runs the whole matrix (`assignRoleAction` → `assignRole`), so a
 * hand-made request gets exactly the answer the form would. The values are seeded when the dialog OPENS
 * (`formSessionReducer`), and «انصراف» / Escape / the overlay drop them — the same session rule as `ResourceForm`.
 */
export function GrantRoleButton({ roleGrant, candidates }: { roleGrant: RoleGrantOptions<SelectOption>; candidates: SelectOption[] }) {
  const router = useRouter();
  const ids = useId();
  const [pending, start] = useTransition();
  const [{ open, values, errors }, dispatch] = useReducer(formSessionReducer, CLOSED_SESSION);
  const form = grantRoleForm(roleGrant, candidates);
  const openForm = () => dispatch({ type: "open", fields: GRANT_ROLE_FIELDS, initial: form.initial });
  const closeForm = () => dispatch({ type: "close" });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const missing = missingPicks(form, values);
    if (Object.keys(missing).length > 0) {
      dispatch({ type: "errors", errors: missing });
      return;
    }
    start(async () => {
      const r = await assignRoleAction({
        personId: String(values.personId),
        roleCode: String(values.roleCode) as AssignableRole,
        schoolId: values.schoolId ? String(values.schoolId) : null,
      });
      if (r.ok) {
        toast.success(r.data.created ? "نقش داده شد." : "این نقش از قبل وجود داشت.");
        closeForm();
        router.refresh();
        return;
      }
      dispatch({ type: "errors", errors: flatten(r.fieldErrors, r.message, form.shown.map((f) => f.name)) });
    });
  };

  return (
    <>
      <Button type="button" onClick={openForm}>
        <Plus className="size-4" aria-hidden />
        {form.title}
      </Button>
      <ResponsiveModal open={open} onOpenChange={(o) => (o ? openForm() : closeForm())} title={form.title} description="دسترسی‌های این نقش از همین لحظه برای همکار فعال می‌شود.">
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {form.shown.map((f) => (
            <Field
              key={f.name}
              field={f}
              id={`${ids}-${f.name}`}
              value={values[f.name]}
              error={errors[f.name]}
              options={form.options[f.optionsKey ?? ""] ?? []}
              onChange={(v) => dispatch({ type: "change", name: f.name, value: v })}
            />
          ))}
          <p role="alert" className={cn("text-sm text-danger", !errors.form && "hidden")}>
            {errors.form}
          </p>
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={closeForm}>
              انصراف
            </Button>
            <Button type="submit" className="min-w-28" disabled={pending}>
              {pending ? "در حال ذخیره…" : "ثبت"}
            </Button>
          </div>
        </form>
      </ResponsiveModal>
    </>
  );
}
