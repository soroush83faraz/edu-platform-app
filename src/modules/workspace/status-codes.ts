// workspace/status-codes — the codes of an item's OWN type for the three transitions the action row offers. Pure (no
// server or client imports), so the detail page (a Server Component) computes them and `WorkItemActions` (a client
// component) sends them; unit-tested in tests/unit/work-item-actions.test.ts.
import type { StatusCategory } from "./repo";

/**
 * `done` / `open` / `cancelled` for a `task` or `todo`, `answered` / `open` / `rejected` for an `admin_request`
 * (scripts/catalog.ts) — read from the type's statuses by category, so no literal code is assumed by the UI.
 */
export interface StatusCodes {
  done: string;
  open: string;
  cancelled: string;
}

/** The first status of each category of the item's type → the codes the action row sends. */
export function statusCodesOf(statuses: ReadonlyArray<{ code: string; category: StatusCategory }>): StatusCodes {
  const of = (category: StatusCategory, fallback: string) => statuses.find((s) => s.category === category)?.code ?? fallback;
  return { done: of("done", "done"), open: of("todo", "open"), cancelled: of("cancelled", "cancelled") };
}
