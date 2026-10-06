// The «اشخاص» picker searches from 0 characters (owner, round 7): an empty query is valid input and lists the
// first people alphabetically (tests/int/workspace-service.test.ts «searchPersons»). No I/O.
import { describe, expect, it } from "vitest";
import { SearchPersonsInput, UpdateWorkItemInput } from "@/modules/workspace/dto";

describe("SearchPersonsInput", () => {
  it("accepts an empty query and a one-letter one; trims; still caps the length and refuses unknown keys", () => {
    expect(SearchPersonsInput.parse({ q: "" })).toEqual({ q: "" });
    expect(SearchPersonsInput.parse({ q: " ز " })).toEqual({ q: "ز" });
    expect(SearchPersonsInput.safeParse({ q: "ا".repeat(61) }).success).toBe(false);
    expect(SearchPersonsInput.safeParse({ q: "", limit: 5 }).success).toBe(false);
  });
});

describe("UpdateWorkItemInput («ویرایش»)", () => {
  const id = "0199a000-00f2-7000-8000-000000000001";
  it("is a PATCH: only the id is required; omitted fields stay omitted (kept by the service)", () => {
    expect(UpdateWorkItemInput.parse({ workItemId: id })).toEqual({ workItemId: id });
    expect(UpdateWorkItemInput.parse({ workItemId: id, title: "  تمرین ۸ ", priority: "high" })).toEqual({ workItemId: id, title: "تمرین ۸", priority: "high" });
  });
  it("lets the description and the deadline be cleared with an empty string", () => {
    expect(UpdateWorkItemInput.parse({ workItemId: id, description: "", dueDate: "" })).toEqual({ workItemId: id, description: "", dueDate: "" });
  });
  it("keeps the create form's limits and refuses unknown keys (no recipients, no status, no organization)", () => {
    expect(UpdateWorkItemInput.safeParse({ workItemId: id, title: "  " }).success).toBe(false);
    expect(UpdateWorkItemInput.safeParse({ workItemId: id, title: "ا".repeat(201) }).success).toBe(false);
    expect(UpdateWorkItemInput.safeParse({ workItemId: id, description: "ا".repeat(4001) }).success).toBe(false);
    expect(UpdateWorkItemInput.safeParse({ workItemId: id, priority: "critical" }).success).toBe(false);
    expect(UpdateWorkItemInput.safeParse({ workItemId: id, dueDate: "۱۴۰۵/۰۷/۰۵۱۲۳۴۵" }).success).toBe(false);
    for (const extra of [{ recipients: { kind: "self" } }, { statusCode: "done" }, { organizationId: id }]) {
      expect(UpdateWorkItemInput.safeParse({ workItemId: id, ...extra }).success).toBe(false);
    }
  });
});
