"use server";
// The ONE server action of the generic admin resources. Gate: session → must-change → strict input → the caller
// holds `iam.admin.access` somewhere → (inside) `resourceOpGate`: the op's permission at any scope (`permission.create`
// for new rows when the resource sets one, else `write`) + the organization-scope rules (`orgOnly` catalogs,
// `createNeedsOrgScope` — new schools are the organization admin's) → the resource's strict Zod schema on `data` →
// the resource handler (row-level scope rule: out of scope = NOT_FOUND) → the tenancy/academic services → audit,
// all in one tx.
import { z } from "zod";
import { defineAction } from "@/lib/actions";
import { forbidden, notFound } from "@/lib/errors";
import { getAdminScope } from "@/modules/iam/service";
import { resourceOpGate } from "./defineResource";
import { RESOURCES, RESOURCE_KEYS } from "./resources";

const MutateInput = z
  .object({
    resource: z.enum(RESOURCE_KEYS),
    op: z.enum(["create", "update", "archive"]),
    id: z.uuid("شناسه نامعتبر است.").optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const adminResourceMutate = defineAction({ schema: MutateInput, permission: "iam.admin.access", scope: "any" }, async (tx, input, ctx) => {
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
});
