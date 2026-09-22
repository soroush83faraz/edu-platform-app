"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useReducer, useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import { adminResourceMutate } from "@/lib/admin/actions";
import { newLabelFa, type FormField, type SelectOption } from "@/lib/admin/defineResource";
import { flatten } from "@/lib/form-errors";
import { CLOSED_SESSION, formSessionReducer, serialize, type FormValue } from "./resource-form-state";
import { ResponsiveModal } from "./ResponsiveModal";

export type { FormValue };

export { flatten };

export interface ResourceFormProps {
  resource: string;
  labelFa: string;
  fields: FormField[];
  options: Record<string, SelectOption[]>;
  mode: "create" | "edit";
  id?: string;
  initial?: Record<string, FormValue>;
  /** Values sent with every submit but never shown (the parent id of a nested resource). */
  fixed?: Record<string, string>;
  /** Trigger rendering: full button (list header), icon (table row) or none — the row's kebab menu opens it through `openSignal`. */
  trigger?: "button" | "icon" | "none";
  /** Increment to open the dialog from outside (`RowActions`); the values are seeded at that moment, like a click. */
  openSignal?: number;
}

/**
 * Generic create/edit form driven by `formFields`; submits through the one admin action and refreshes the page.
 * State lives in `formSessionReducer` (resource-form-state.ts): the values are seeded from `initial` when the
 * dialog OPENS, so after a save (close → `router.refresh()` → fresh props) the next open shows the saved row, and
 * «انصراف» / Escape / the overlay drop edits and errors alike (QA round 2, MAJOR).
 */
export function ResourceForm({ resource, labelFa, fields, options, mode, id, initial, fixed, trigger = "button", openSignal = 0 }: ResourceFormProps) {
  const router = useRouter();
  const ids = useId();
  const [pending, start] = useTransition();
  const [{ open, values, errors }, dispatch] = useReducer(formSessionReducer, CLOSED_SESSION);
  const visible = fields.filter((f) => mode === "create" || !f.createOnly);

  // `initial` is read HERE, from the props of the render that handles the click — never from a stale closure.
  const openForm = () => dispatch({ type: "open", fields: visible, initial });
  const closeForm = () => dispatch({ type: "close" });
  // A menu item elsewhere asked for the dialog: the same open as a click on the trigger, seeded from the props of
  // THIS render (state adjusted during render — React's "derive from a prop" pattern, no effect).
  const [seenSignal, setSeenSignal] = useState(openSignal);
  if (openSignal !== seenSignal) {
    setSeenSignal(openSignal);
    dispatch({ type: "open", fields: visible, initial });
  }

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data: Record<string, unknown> = { ...(fixed ?? {}) };
    for (const f of visible) data[f.name] = serialize(f, values[f.name]);
    start(async () => {
      const r = await adminResourceMutate({ resource, op: mode === "create" ? "create" : "update", id, data });
      if (r.ok) {
        toast.success(mode === "create" ? `${labelFa} ثبت شد.` : "تغییرات ذخیره شد.");
        closeForm();
        router.refresh();
        return;
      }
      dispatch({ type: "errors", errors: flatten(r.fieldErrors, r.message, visible.map((f) => f.name)) });
    });
  };

  const title = mode === "create" ? newLabelFa(labelFa) : `ویرایش ${labelFa}`;
  return (
    <>
      {trigger === "none" ? null : trigger === "icon" ? (
        <Button type="button" variant="ghost" size="icon" aria-label={title} onClick={openForm} className="size-11 md:size-9">
          <Pencil className="size-4" aria-hidden />
        </Button>
      ) : (
        <Button type="button" onClick={openForm}>
          <Plus className="size-4" aria-hidden />
          {title}
        </Button>
      )}
      <ResponsiveModal open={open} onOpenChange={(o) => (o ? openForm() : closeForm())} title={title}>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {visible.map((f) => (
            <Field key={f.name} field={f} id={`${ids}-${f.name}`} value={values[f.name]} error={errors[f.name]} options={f.options ?? (f.optionsKey ? options[f.optionsKey] ?? [] : [])} onChange={(v) => dispatch({ type: "change", name: f.name, value: v })} />
          ))}
          <p role="alert" className={cn("text-sm text-danger", !errors.form && "hidden")}>
            {errors.form}
          </p>
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={closeForm}>
              انصراف
            </Button>
            <Button type="submit" className="min-w-28" disabled={pending}>
              {pending ? "در حال ذخیره…" : mode === "create" ? "ثبت" : "ذخیره"}
            </Button>
          </div>
        </form>
      </ResponsiveModal>
    </>
  );
}

export function Field({
  field,
  id,
  value,
  error,
  options,
  onChange,
}: {
  field: FormField;
  id: string;
  value: FormValue;
  error?: string;
  options: SelectOption[];
  onChange: (v: FormValue) => void;
}) {
  const errId = `${id}-err`;
  const label = (
    <Label htmlFor={id}>
      {field.labelFa}
      {field.required ? null : <span className="text-text-faint"> (اختیاری)</span>}
    </Label>
  );
  if (field.type === "toggle") {
    return (
      <div className="flex flex-col gap-1">
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-text">
          <input id={id} type="checkbox" className="size-5 accent-primary-600" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          {field.labelFa}
        </label>
        {field.hint ? <p className="text-sm leading-6 text-text-muted">{field.hint}</p> : null}
        <FieldError id={errId} text={error} />
      </div>
    );
  }
  if (field.type === "select") {
    const groups = [...new Set(options.map((o) => o.group).filter((g): g is string => !!g))];
    const render = (opts: SelectOption[]) =>
      opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ));
    return (
      <div className="flex flex-col gap-1.5">
        {label}
        <SelectNative
          id={id}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
        >
          {!field.required || value === "" ? <option value="">{field.required ? "انتخاب کنید…" : "—"}</option> : null}
          {groups.length > 0
            ? groups.map((g) => (
                <optgroup key={g} label={g}>
                  {render(options.filter((o) => o.group === g))}
                </optgroup>
              ))
            : render(options)}
        </SelectNative>
        {field.hint ? <p className="text-sm leading-6 text-text-muted">{field.hint}</p> : null}
        <FieldError id={errId} text={error} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {label}
      <Input
        id={id}
        value={value === null || value === undefined ? "" : String(value)}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        inputMode={field.numeric || field.type === "number" || field.type === "jalali_date" ? "numeric" : undefined}
        dir={field.ltr ? "ltr" : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        className={cn((field.type === "number" || field.type === "jalali_date") && "tabular", field.ltr && "text-start")}
        autoComplete="off"
      />
      {field.hint ? <p className="text-sm leading-6 text-text-muted">{field.hint}</p> : null}
      <FieldError id={errId} text={error} />
    </div>
  );
}

export function FieldError({ id, text }: { id: string; text?: string }) {
  return (
    <p id={id} role="alert" className={cn("text-sm text-danger", !text && "hidden")}>
      {text}
    </p>
  );
}
