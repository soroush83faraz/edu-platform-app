// Pure helper shared by the admin forms (no server imports, unit-tested).
import type { FieldErrors } from "@/lib/actions";

/**
 * Server field errors → one message per rendered field. Errors on fields the form does NOT render (a `createOnly`
 * key on an edit, a fixed parent id, a schema/form mismatch) are folded into the form-level line as
 * «خطای اعتبارسنجی: …» — so a validation failure can never be silent. `rendered` = the field names on screen;
 * when omitted every field error is treated as rendered (legacy callers).
 */
export function flatten(fieldErrors: FieldErrors | undefined, message: string, rendered?: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const hidden: string[] = [];
  for (const [k, v] of Object.entries(fieldErrors ?? {})) {
    if (!v[0]) continue;
    const key = k.split(".")[0];
    if (rendered && !rendered.includes(key)) hidden.push(v[0]);
    else out[key] = v[0];
  }
  if (hidden.length > 0) out.form = `خطای اعتبارسنجی: ${[...new Set(hidden)].join(" ")}`;
  if (Object.keys(out).length === 0) out.form = message;
  return out;
}
