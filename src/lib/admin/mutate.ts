// The body of `adminResourceMutate` without the session gate, so int tests can drive the EXACT path the form
// takes (gate → strict schema on the form's payload → handler) inside a rolled-back tenant transaction.
import { z } from "zod";
import type { Tx } from "@/lib/actions";
import { forbidden, notFound } from "@/lib/errors";
import { getAdminScope } from "@/modules/iam/service";
import { resourceOpGate, type ResourceCtx } from "./defineResource";
import { RESOURCES, RESOURCE_KEYS } from "./resources";

export const MutateInput = z
  .object({
    resource: z.enum(RESOURCE_KEYS),
    op: z.enum(["create", "update", "archive"]),
    id: z.uuid("شناسه نامعتبر است.").optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type MutateInput = z.output<typeof MutateInput>;

/**
 * Gate (`iam.admin.access` is checked by the action) → `resourceOpGate` (the op's permission at any scope + the
 * organization-scope rules) → the resource's strict Zod schema on `data` → the resource handler (row-level scope
 * rule: out of scope = NOT_FOUND) → the tenancy/academic services → audit, all in the caller's transaction.
 */
export async function mutateResource(tx: Tx, ctx: ResourceCtx, input: MutateInput): Promise<{ id: string }> {
  const def = RESOURCES[input.resource];
  if (!def) throw notFound();
  const scope = await getAdminScope(tx, ctx);
  const gate = resourceOpGate(def, input.op, ctx.assignments, scope);
  if (!gate.ok) throw forbidden(gate.message);
  switch (input.op) {
    case "create": {
      const data = def.schema.parse(input.data ?? {});
      return def.create(tx, ctx, scope, data);
    }
    case "update": {
      if (!input.id) throw notFound();
      const data = def.schema.parse(input.data ?? {});
      await def.update(tx, ctx, scope, input.id, data);
      return { id: input.id };
    }
    case "archive": {
      if (!input.id || !def.archive) throw notFound();
      await def.archive.run(tx, ctx, scope, input.id);
      return { id: input.id };
    }
  }
}
