// The action row of a کار (src/modules/workspace/ui/WorkItemActions.tsx) draws its buttons from `isManager`, the
// detail read model's `managesItem` (verifier, 2026-09-27): an ASSIGNEE — a principal given a «تسک» by the
// organization admin included, whose `isManager` is false — sees «انجام شد» and nothing of the giver's; the item's
// manager sees «اتمام» / «ویرایش» / «حذف», and «بازیابی» once it is closed. Rendered statically, inspected as strings
// (the dialogs are closed, so only the row's own buttons are in the markup).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { workItemWords } from "@/lib/work-item-words";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, back: () => {} }) }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
// The server actions pull in the whole server stack (db, session); nothing here is clicked.
vi.mock("@/modules/workspace/actions", () => {
  const never = async () => ({ ok: false, code: "INTERNAL", message: "" });
  return { changeStatusAction: never, updateWorkItemAction: never, markInboxReadAction: never };
});

const { WorkItemActions } = await import("@/modules/workspace/ui/WorkItemActions");

type Props = Parameters<typeof WorkItemActions>[0];
const words = workItemWords("task");
const base: Props = {
  workItemId: "0199a000-00f2-7000-8000-000000000001",
  title: "گزارش ماهانه",
  description: null,
  priority: "normal",
  statusCategory: "todo",
  dueAt: null,
  assigneeCount: 2,
  myAssigneeState: null,
  isManager: false,
  canUpdate: true,
  inboxState: "read",
  words,
  noun: words.singular,
};
const render = (p: Partial<Props>) => renderToStaticMarkup(createElement(WorkItemActions, { ...base, ...p }));

const ASSIGNEE = "انجام شد";
const GIVER = ["اتمام", "ویرایش", "حذف", "بازیابی"];

describe("WorkItemActions — the assignee set vs. the manager set", () => {
  it("a broad admin who is an ASSIGNEE of someone else's item (isManager false) gets «انجام شد» only", () => {
    const html = render({ myAssigneeState: "pending", isManager: false });
    expect(html).toContain(ASSIGNEE);
    for (const label of GIVER) expect(html, label).not.toContain(label);
  });

  it("once their own row is done, the assignee has nothing left to press (the giver's buttons never appear)", () => {
    const html = render({ myAssigneeState: "done", isManager: false });
    expect(html).not.toContain("<button");
  });

  it("the manager who is not an assignee (the giver, or a broad admin's override) gets «اتمام» / «ویرایش» / «حذف»", () => {
    const html = render({ myAssigneeState: null, isManager: true });
    for (const label of ["اتمام", "ویرایش", "حذف"]) expect(html, label).toContain(label);
    expect(html).not.toContain("تمدید");
    expect(html).not.toContain(ASSIGNEE);
    expect(html).not.toContain("بازیابی");
  });

  it("on a closed item the manager gets «بازیابی» (+ «حذف» when it is done); an assignee gets nothing", () => {
    const done = render({ statusCategory: "done", isManager: true });
    expect(done).toContain("بازیابی");
    expect(done).toContain("حذف");
    expect(done, "a closed item is not edited").not.toContain("ویرایش");
    const removed = render({ statusCategory: "cancelled", isManager: true });
    expect(removed).toContain("بازیابی");
    expect(removed).not.toContain("حذف");
    expect(render({ statusCategory: "done", myAssigneeState: "done", isManager: false })).not.toContain("<button");
  });

  it("without `update` at any scope nothing is offered, whatever `isManager` says", () => {
    expect(render({ myAssigneeState: "pending", isManager: true, canUpdate: false })).not.toContain("<button");
  });
});
