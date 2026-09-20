"use server";
// The ONE server action of the generic admin resources. Gate: session → must-change → strict input → the caller
// holds `iam.admin.access` somewhere → (inside) the resource's write permission at any scope + the admin scope
// rule (getAdminScope; school-owned rows must be in the caller's schools, org catalogs need an organization-scoped
// admin) → the resource's strict Zod schema on `data` → the tenancy/academic services → audit, all in one tx.
import { z } from "zod";
import { defineAction } from "@/lib/actions";
import { forbidden, notFound } from "@/lib/errors";
import { canAtAnyScope } from "@/modules/iam/can";
import { getAdminScope } from "@/modules/iam/service";
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
  if (!canAtAnyScope(ctx.assignments, def.permission.write)) throw forbidden();
  const scope = await getAdminScope(tx, ctx);
  if (def.orgOnly && scope.kind !== "organization") throw forbidden("این بخش را فقط مدیر سازمان می‌تواند ویرایش کند.");
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
