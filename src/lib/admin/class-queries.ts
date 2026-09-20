// The class card (/admin/classes/[id]): facts + roster + offerings, one gate.
import { defineQuery } from "@/lib/actions";
import { notFound } from "@/lib/errors";
import { getAdminScope } from "@/modules/iam/service";
import { ClassIdInput } from "./people-dto";
import { listStudents } from "./people";
import { listClassRows, listOfferingRows } from "./resources";

export const classDetailQuery = defineQuery({ schema: ClassIdInput, permission: "tenancy.structure.read", scope: "any" }, async (tx, input, ctx) => {
  const scope = await getAdminScope(tx, ctx);
  const { rows } = await listClassRows(tx, scope, { ids: [input.classGroupId], includeArchived: true });
  const cls = rows[0];
  if (!cls) throw notFound();
  const roster = (await listStudents(tx, scope, { q: "", page: 1, pageSize: 500, classGroupId: cls.id })).rows;
  const offerings = (await listOfferingRows(tx, scope, cls.id)).rows;
  return { cls, roster, offerings };
});
