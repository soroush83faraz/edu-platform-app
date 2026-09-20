// Read side of the generic admin resources (Server Components). Same gate as the action; lists are filtered by the
// admin scope inside each resource's `list`. `canWrite` tells the page whether to render the form/archive buttons.
import { z } from "zod";
import { defineQuery } from "@/lib/actions";
import { notFound } from "@/lib/errors";
import { canAtAnyScope } from "@/modules/iam/can";
import { getAdminScope, type AdminScope } from "@/modules/iam/service";
import { PAGE_SIZE, type SelectOption } from "./defineResource";
import { RESOURCES, RESOURCE_KEYS } from "./resources";

const ListInput = z
  .object({
    resource: z.enum(RESOURCE_KEYS),
    q: z.string().trim().max(80).default(""),
    page: z.number().int().min(1).max(10_000).default(1),
    parent: z.uuid().optional(),
  })
  .strict();

export interface ResourceListData {
  rows: Array<{ id: string } & Record<string, unknown>>;
  total: number;
  page: number;
  pageSize: number;
  options: Record<string, SelectOption[]>;
  scope: AdminScope;
  canWrite: boolean;
}

export const adminResourceList = defineQuery<ResourceListData, typeof ListInput>({ schema: ListInput, permission: "iam.admin.access", scope: "any" }, async (tx, input, ctx) => {
  const def = RESOURCES[input.resource];
  if (!def) throw notFound();
  const scope = await getAdminScope(tx, ctx);
  const canWrite = canAtAnyScope(ctx.assignments, def.permission.write) && (!def.orgOnly || scope.kind === "organization");
  const { rows, total } = await def.list(tx, ctx, scope, { q: input.q, page: input.page, pageSize: PAGE_SIZE, parent: input.parent });
  const options = canWrite && def.loadOptions ? await def.loadOptions(tx, ctx, scope, input.parent) : {};
  return { rows, total, page: input.page, pageSize: PAGE_SIZE, options, scope, canWrite };
});

/** The admin scope of the caller (for pages that are not generic resources). */
export const adminScopeQuery = defineQuery({ permission: "iam.admin.access", scope: "any" }, async (tx, _input, ctx) => getAdminScope(tx, ctx));
