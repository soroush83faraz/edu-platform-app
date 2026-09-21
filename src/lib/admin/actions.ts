"use server";
// The ONE server action of the generic admin resources. Gate: session → must-change → strict input → the caller
// holds `iam.admin.access` somewhere → `mutateResource` (src/lib/admin/mutate.ts: `resourceOpGate`, the resource's
// strict Zod schema on `data`, the handler, the services, audit — all in one tx). The body lives in mutate.ts so int
// tests can run the form's exact payload through it without a session.
import { defineAction } from "@/lib/actions";
import { MutateInput, mutateResource } from "./mutate";

export const adminResourceMutate = defineAction({ schema: MutateInput, permission: "iam.admin.access", scope: "any" }, async (tx, input, ctx) => mutateResource(tx, ctx, input));
