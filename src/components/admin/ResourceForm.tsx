"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import { adminResourceMutate } from "@/lib/admin/actions";
import { newLabelFa, type FormField, type SelectOption } from "@/lib/admin/defineResource";
import { flatten } from "@/lib/form-errors";
import { toAsciiDigits } from "@/lib/normalize";
import { ResponsiveModal } from "./ResponsiveModal";

export type FormValue = string | number | boolean | null;

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
  /** Trigger rendering: full button (list header) or icon (table row). */
  trigger?: "button" | "icon";
}

/** Generic create/edit form driven by `formFields`; submits through the one admin action and refreshes the page. */
export function ResourceForm({ resource, labelFa, fields, options, mode, id, initial, fixed, trigger = "button" }: ResourceFormProps) {
  const router = useRouter();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const visible = fields.filter((f) => mode === "create" || !f.createOnly);
  const [values, setValues] = useState<Record<string, FormValue>>(() => defaults(visible, initial));

  const reset = () => {
    setValues(defaults(visible, initial));
    setErrors({});
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data: Record<string, unknown> = { ...(fixed ?? {}) };
    for (const f of visible) data[f.name] = serialize(f, values[f.name]);
    start(async () => {
      const r = await adminResourceMutate({ resource, op: mode === "create" ? "create" : "update", id, data });
      if (r.ok) {
        toast.success(mode === "create" ? `${labelFa} ثبت شد.` : "تغییرات ذخیره شد.");
        setOpen(false);
        reset();
        router.refresh();
        return;
      }
      setErrors(flatten(r.fieldErrors, r.message, visible.map((f) => f.name)));
    });
  };

  const title = mode === "create" ? newLabelFa(labelFa) : `ویرایش ${labelFa}`;
  return (
    <>
      {trigger === "icon" ? (
        <Button type="button" variant="ghost" size="icon" aria-label={title} onClick={() => setOpen(true)} className="size-11 md:size-9">
          <Pencil className="size-4" aria-hidden />
        </Button>
      ) : (
        <Button type="button" onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden />
          {title}
        </Button>
      )}
      <ResponsiveModal
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
        title={title}
      >
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {visible.map((f) => (
            <Field key={f.name} field={f} id={`${ids}-${f.name}`} value={values[f.name]} error={errors[f.name]} options={f.options ?? (f.optionsKey ? options[f.optionsKey] ?? [] : [])} onChange={(v) => setValues((prev) => ({ ...prev, [f.name]: v }))} />
          ))}
          <p role="alert" className={cn("text-sm text-danger", !errors.form && "hidden")}>
            {errors.form}
          </p>
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
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

function defaults(fields: FormField[], initial?: Record<string, FormValue>): Record<string, FormValue> {
  const out: Record<string, FormValue> = {};
  for (const f of fields) {
    const v = initial?.[f.name];
    if (v !== undefined) out[f.name] = v;
    else if (f.type === "toggle") out[f.name] = f.name === "withTerms";
    else if (f.type === "select") out[f.name] = f.options?.[0]?.value ?? "";
    else out[f.name] = "";
  }
  return out;
}

/** Form value → what the strict Zod schema expects: trimmed strings, real numbers (null when empty), booleans. */
function serialize(field: FormField, value: FormValue): unknown {
  switch (field.type) {
    case "toggle":
      return value === true;
    case "number": {
      if (value === null || value === undefined || value === "") return null;
      const n = Number(toAsciiDigits(String(value)).replace(/[٬,\s]/g, ""));
      return Number.isFinite(n) ? n : String(value);
    }
    case "select":
      return value === "" || value === null ? (field.required ? "" : null) : String(value);
    default:
      return value === null ? "" : String(value).trim();
  }
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
