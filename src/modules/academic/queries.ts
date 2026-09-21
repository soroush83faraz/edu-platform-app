// Read-only queries for pages (Server Components). Same gate as actions: session → must-change → permission.
import { defineQuery } from "@/lib/actions";
import { getMyClass } from "./repo";

export type { MyClass, MyClassTeacher } from "./repo";

/** «کلاس من» of the signed-in student (null without an active enrollment). Personal read — checked at any scope. */
export const myClassQuery = defineQuery({ permission: "workspace.work_item.read", scope: "any" }, async (tx, _input, ctx) => getMyClass(tx, ctx.personId));
