// The single gate every Server Action / Route Handler passes through:
//   session (requireContext) → must_change_password gate → Zod `.strict()` parse → can() → withTenant → handler.
// Anything thrown is mapped by `toResult` to a Persian, stack-free `Result`; Next's redirect() errors are
// re-thrown untouched (redirect works by throwing — a try/catch that swallows them breaks navigation).
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/client";
import { getRequestContext, requireContext, type Ctx } from "@/lib/ctx";
import { AppError, FA_MESSAGES, forbidden, passwordChangeRequired, type ErrorCode } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { can } from "@/modules/iam/can";
import type { Permission, ScopeRef } from "@/modules/iam/permissions";
import { readSessionToken, setSessionCookie } from "@/modules/iam/session";

export type FieldErrors = Record<string, string[]>;

export type Result<T> = { ok: true; data: T } | { ok: false; code: ErrorCode; message: string; fieldErrors?: FieldErrors };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = (code: ErrorCode, message?: string, fieldErrors?: FieldErrors): Result<never> => ({
  ok: false,
  code,
  message: message ?? FA_MESSAGES[code],
  ...(fieldErrors ? { fieldErrors } : {}),
});

export interface ActionOptions<S extends z.ZodType> {
  /** A `z.object({...}).strict()` — unknown keys are rejected, nothing from the client is spread into queries. */
  schema: S;
  /** REQUIRED. The only anonymous entry points are login and /api/health, and neither uses defineAction. */
  permission: Permission;
  /** The entity the action operates on; undefined = organization-level check. Derived from the PARSED input. */
  scope?: (input: z.output<S>) => ScopeRef | undefined;
  /** Only changePasswordAction / logoutAction may run while `must_change_password` is set. */
  allowPasswordChangePending?: boolean;
}

export type ActionHandler<S extends z.ZodType, R> = (tx: Tx, input: z.output<S>, ctx: Ctx) => Promise<R>;

/** Server Actions receive FormData from `<form action>` and plain objects from programmatic calls. */
export function toPlainInput(raw: unknown): unknown {
  if (!(raw instanceof FormData)) return raw;
  const out: Record<string, unknown> = {};
  for (const [key, value] of raw.entries()) {
    if (key.startsWith("$ACTION")) continue; // Next's progressive-enhancement bookkeeping fields
    if (typeof value !== "string") continue; // file uploads are not part of phase 1
    const existing = out[key];
    if (existing === undefined) out[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else out[key] = [existing, value];
  }
  return out;
}

/** Checkbox → boolean (`"on"` when checked, absent otherwise). Use inside `.strict()` schemas. */
export const zFormBoolean = () => z.preprocess((v) => v === true || v === "on" || v === "true" || v === "1", z.boolean()).default(false);

function pgCode(err: unknown, depth = 0): string | undefined {
  if (depth > 4 || typeof err !== "object" || err === null) return undefined;
  const e = err as { code?: unknown; cause?: unknown };
  if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
  return pgCode(e.cause, depth + 1);
}

/** Error → Result. Never leaks a stack or an SQL message; INTERNAL is logged with the request id. */
export function toResult(err: unknown, requestId: string): Result<never> {
  if (isRedirectError(err)) throw err;
  if (AppError.is(err)) {
    const details = err.details as { fieldErrors?: FieldErrors } | undefined;
    return fail(err.code, err.message, details?.fieldErrors);
  }
  if (err instanceof z.ZodError) {
    const flat = z.flattenError(err);
    const fieldErrors = flat.fieldErrors as FieldErrors;
    return fail("VALIDATION", undefined, fieldErrors);
  }
  const code = pgCode(err);
  if (code === "23505") return fail("CONFLICT");
  if (code === "23503") return fail("INVALID_REFERENCE");
  logger.error({ err, requestId }, "action failed");
  return fail("INTERNAL");
}

async function authorize<S extends z.ZodType>(ctx: Ctx, opts: ActionOptions<S>, raw: unknown): Promise<z.output<S>> {
  if (ctx.mustChangePassword && !opts.allowPasswordChangePending) throw passwordChangeRequired();
  return opts.schema.parse(toPlainInput(raw)) as z.output<S>;
}

/** After a sliding extension the cookie must follow the row; only possible in an action (not during render). */
async function reissueCookieIfExtended(ctx: Ctx): Promise<void> {
  if (!ctx.session.extended) return;
  try {
    const token = await readSessionToken();
    if (token) await setSessionCookie(token, { isPublicDevice: ctx.session.isPublicDevice, expiresAt: ctx.session.expiresAt });
  } catch {
    /* render context: cookies are read-only here; the next action re-issues it */
  }
}

export function defineAction<S extends z.ZodType, R>(
  opts: ActionOptions<S>,
  handler: ActionHandler<S, R>,
): (raw: FormData | unknown) => Promise<Result<R>> {
  return async (raw) => {
    let requestId = "-";
    try {
      const ctx = await requireContext();
      requestId = ctx.requestId;
      const input = await authorize(ctx, opts, raw);
      const ref = opts.scope?.(input);
      const data = await withTenant({ orgId: ctx.orgId, personId: ctx.personId }, async (tx) => {
        if (!(await can(tx, ctx, opts.permission, ref))) throw forbidden();
        return handler(tx, input, ctx);
      });
      await reissueCookieIfExtended(ctx);
      return ok(data);
    } catch (err) {
      return toResult(err, requestId);
    }
  };
}

export interface QueryOptions<S extends z.ZodType | undefined> {
  schema?: S;
  permission: Permission;
  scope?: (input: S extends z.ZodType ? z.output<S> : undefined) => ScopeRef | undefined;
  allowPasswordChangePending?: boolean;
}

type QueryInput<S> = S extends z.ZodType ? z.output<S> : undefined;

/** Read-only twin of defineAction for Server Components: same gate, plain-object input, no cookie writes. */
export function defineQuery<R, S extends z.ZodType | undefined = undefined>(
  opts: QueryOptions<S>,
  handler: (tx: Tx, input: QueryInput<S>, ctx: Ctx) => Promise<R>,
): (raw?: unknown) => Promise<Result<R>> {
  return async (raw) => {
    let requestId = "-";
    try {
      const ctx = await requireContext();
      requestId = ctx.requestId;
      if (ctx.mustChangePassword && !opts.allowPasswordChangePending) throw passwordChangeRequired();
      const input = (opts.schema ? opts.schema.parse(raw ?? {}) : undefined) as QueryInput<S>;
      const ref = opts.scope?.(input);
      const data = await withTenant({ orgId: ctx.orgId, personId: ctx.personId }, async (tx) => {
        if (!(await can(tx, ctx, opts.permission, ref))) throw forbidden();
        return handler(tx, input, ctx);
      });
      return ok(data);
    } catch (err) {
      return toResult(err, requestId);
    }
  };
}

export { getRequestContext, requireContext };
export type { Ctx };
