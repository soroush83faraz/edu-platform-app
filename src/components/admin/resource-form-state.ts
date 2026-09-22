// The local state of `ResourceForm` as a pure reducer, so the one rule that bit QA round 2 is written down and
// unit-tested (tests/unit/resource-form-state.test.ts): the field values are seeded from the row's CURRENT
// `initial` at the moment the dialog OPENS — never at mount and never from a stale closure. After «ذخیره» the
// dialog closes and the page refreshes; the next open reads the refreshed props, so the form shows the saved row
// (before: `useState(() => defaults(...))` ran once, `reset()` re-applied the OLD `initial` and a no-op resubmit
// wrote the old value back). Closing — «انصراف», Escape, the overlay — discards edits and errors the same way.
import type { FormField, SelectOption } from "@/lib/admin/defineResource";
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

/** The options a field actually offers: its own static list, or the set `optionsKey` names. */
export function optionsOf(field: FormField, options: Record<string, SelectOption[]>): SelectOption[] {
  return field.options ?? (field.optionsKey ? (options[field.optionsKey] ?? []) : []);
}

/**
 * A REQUIRED picker with exactly ONE possible value is not a choice — it repeats what the caller's scope already
 * decided (the only school, its only branch, its only academic year). Such a field is not rendered at all; its
 * value is seeded by `seedValues` and submitted like any other (owner, QA round 3: «مدرسه / شعبه» on a form where
 * both were foregone conclusions). Two exceptions keep their control: an OPTIONAL picker («بدون دبیر» is a real
 * answer), and a lone option that sits under a GROUP heading — the heading names a parent the form also asks for
 * (the single academic year of one of two schools), so the reader must see which parent it belongs to.
 */
export function isSettled(field: FormField, options: Record<string, SelectOption[]>): boolean {
  if (field.type !== "select" || field.required !== true) return false;
  const only = optionsOf(field, options);
  return only.length === 1 && !only[0].group;
}

/** `initial` plus the single value of every settled picker that `initial` leaves empty. */
export function seedValues(fields: FormField[], options: Record<string, SelectOption[]>, initial?: Record<string, FormValue>): Record<string, FormValue> {
  const out: Record<string, FormValue> = { ...(initial ?? {}) };
  for (const f of fields) {
    const v = out[f.name];
    if (isSettled(f, options) && (v === undefined || v === null || v === "")) out[f.name] = optionsOf(f, options)[0].value;
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
