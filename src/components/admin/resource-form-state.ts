// The local state of `ResourceForm` as a pure reducer, so the one rule that bit QA round 2 is written down and
// unit-tested (tests/unit/resource-form-state.test.ts): the field values are seeded from the row's CURRENT
// `initial` at the moment the dialog OPENS — never at mount and never from a stale closure. After «ذخیره» the
// dialog closes and the page refreshes; the next open reads the refreshed props, so the form shows the saved row
// (before: `useState(() => defaults(...))` ran once, `reset()` re-applied the OLD `initial` and a no-op resubmit
// wrote the old value back). Closing — «انصراف», Escape, the overlay — discards edits and errors the same way.
import type { FormField } from "@/lib/admin/defineResource";
import { toAsciiDigits } from "@/lib/normalize";

export type FormValue = string | number | boolean | null;

export interface FormSession {
  open: boolean;
  values: Record<string, FormValue>;
  errors: Record<string, string>;
}

export type FormSessionEvent =
  /** The dialog opens: seed every visible field from the row as it is NOW. */
  | { type: "open"; fields: FormField[]; initial?: Record<string, FormValue> }
  | { type: "change"; name: string; value: FormValue }
  | { type: "errors"; errors: Record<string, string> }
  /** «انصراف», Escape, overlay click or a successful save: edits and errors are dropped. */
  | { type: "close" };

export const CLOSED_SESSION: FormSession = { open: false, values: {}, errors: {} };

export function formSessionReducer(state: FormSession, event: FormSessionEvent): FormSession {
  switch (event.type) {
    case "open":
      return { open: true, values: defaults(event.fields, event.initial), errors: {} };
    case "change":
      return { ...state, values: { ...state.values, [event.name]: event.value } };
    case "errors":
      return { ...state, errors: event.errors };
    case "close":
      return CLOSED_SESSION;
  }
}

/** The form's starting values: the row's value when given, else the field type's empty value. */
export function defaults(fields: FormField[], initial?: Record<string, FormValue>): Record<string, FormValue> {
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
export function serialize(field: FormField, value: FormValue): unknown {
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
